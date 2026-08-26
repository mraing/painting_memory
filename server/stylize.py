# 侘寂纸感风格化（v3：AnimeGANv2 生成式风格化 + 侘寂后处理）
# 主链：AnimeGANv2（face_paint，ONNX 本地推理，整图插画化）→ 侘寂调色 → 纸纹理混合 → 颗粒。
# 回退链（模型缺失/失败）：调色 → bilateral 磨平 → 色阶量化 → 纸混合 → 颗粒（纯确定性）。
import os
import threading

import cv2
import numpy as np

MODELS_DIR = os.environ.get('HUIYI_MODELS_DIR', os.path.join(os.path.dirname(__file__), 'models'))
# 风格权重优先级：Hayao（宫崎骏）→ face_paint（兜底）→ 确定性链
# 每项：(文件名, 推理边长, 是否 NHWC 动态输入)
ANIME_MODELS = [
    ('animegan_hayao.onnx', 256, True),
    ('animegan_face_paint.onnx', 512, False),
]

# —— 参数（可调）——
LIFT = 14.0        # 阴影抬升强度（去死黑）
WARM_R = 9.0       # 暖色偏移：红通道 +
WARM_B = 9.0       # 暖色偏移：蓝通道 −
DESAT = 0.16       # 整体去饱和（0..1）
FLATTEN_D = 9      # bilateral 直径
FLATTEN_SC = 40.0  # bilateral 色彩 σ（越大越平）
FLATTEN_SS = 9.0   # bilateral 空间 σ
POSTERIZE_LEVELS = 14   # 每通道色阶数（<2 关闭；越小色块感越强）
POSTERIZE_STRENGTH = 0.68  # 量化结果与原图混合比（保留部分写实信息）
PAPER_BLEND = 0.30  # 纸纹理混合强度（0..1）
GRAIN = 7.0         # 细颗粒幅度
FIBER = 6.0         # 纤维纹理幅度

_anime_lock = threading.Lock()
_anime_session = None
_anime_error = None
_anime_nhwc = False   # 当前权重是否为 NHWC 动态输入
_anime_size = 256


def _load_animegan():
    """懒加载 AnimeGAN ONNX（Hayao 优先，face_paint 兜底；全部缺失 → 回退确定性链）"""
    global _anime_session, _anime_error, _anime_nhwc, _anime_size
    if _anime_session is not None or _anime_error is not None:
        return
    with _anime_lock:
        if _anime_session is not None or _anime_error is not None:
            return
        try:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = 4  # 限制单会话线程，避免多模型并行时争抢 CPU 核
            errors = []
            for fname, size, nhwc in ANIME_MODELS:
                path = os.path.join(MODELS_DIR, fname)
                if not os.path.exists(path):
                    errors.append(f'{fname} 缺失')
                    continue
                try:
                    _anime_session = ort.InferenceSession(path, sess_options=so, providers=['CPUExecutionProvider'])
                    _anime_nhwc = nhwc
                    _anime_size = size
                    return
                except Exception as exc:
                    errors.append(f'{fname}: {exc}')
            raise RuntimeError('；'.join(errors))
        except Exception as exc:
            _anime_error = exc
            print(f'[stylize] AnimeGAN 不可用（{exc}），回退确定性风格化')


def animegan(bgr: np.ndarray) -> np.ndarray | None:
    """AnimeGANv2 整图插画化（Hayao 宫崎骏风优先；推理尺寸 → 原尺寸返回 BGR）；不可用返回 None"""
    _load_animegan()
    if _anime_session is None:
        return None
    h, w = bgr.shape[:2]
    s = _anime_size
    img = cv2.resize(bgr, (s, s), interpolation=cv2.INTER_AREA)
    x = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
    x = x / 127.5 - 1.0  # [-1, 1]
    if _anime_nhwc:
        x = x[None, ...]  # (1, H, W, 3)
    else:
        x = x.transpose(2, 0, 1)[None]  # (1, 3, H, W)
    out = _anime_session.run(None, {_anime_session.get_inputs()[0].name: x})[0]
    if _anime_nhwc:
        out = out[0]  # (H, W, 3)
    else:
        out = out[0].transpose(1, 2, 0)  # (H, W, 3)
    out = ((out * 0.5 + 0.5).clip(0, 1) * 255).astype(np.uint8)
    out = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    if (w, h) != (s, s):
        out = cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)
    return out


def _grade_lut() -> np.ndarray:
    """侘寂调色 LUT（0..255 → 0..255）：阴影抬升 + 暖米偏移 + 轻去饱和。"""
    x = np.arange(256, dtype=np.float32)
    lift = x + LIFT * (1 - x / 255.0)  # 阴影抬升，高光趋近不变
    lift = np.clip(lift, 0, 255)
    # 暖米偏移（分通道）与去饱和合并进 LUT
    gray = lift * 0.299 + lift * 0.587 + lift * 0.114
    r = np.clip(lift * (1 - DESAT) + gray * DESAT + WARM_R, 0, 255)
    g = np.clip(lift * (1 - DESAT) + gray * DESAT, 0, 255)
    b = np.clip(lift * (1 - DESAT) + gray * DESAT - WARM_B, 0, 255)
    # cv2.LUT 多通道要求 (256, 1, cn) 布局，通道顺序 BGR
    return np.stack([b, g, r], axis=1).reshape(256, 1, 3).astype(np.uint8)


_GRADE = _grade_lut()


def grade(bgr: np.ndarray) -> np.ndarray:
    """应用侘寂调色 LUT（查表，O(n) 极快）。"""
    return cv2.LUT(bgr, _GRADE)


def flatten(bgr: np.ndarray) -> np.ndarray:
    """bilateral 保边磨平（半分辨率执行后放大：视觉等价，耗时 ~1/8）：
    抹去数码噪点/锐利边缘，保留主体边界（纸面感）。"""
    h, w = bgr.shape[:2]
    small = cv2.resize(bgr, (max(1, w >> 1), max(1, h >> 1)), interpolation=cv2.INTER_AREA)
    small = cv2.bilateralFilter(small, FLATTEN_D, FLATTEN_SC, FLATTEN_SS)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)


def posterize(bgr: np.ndarray) -> np.ndarray:
    """色阶量化（带抖动噪声防色带）：版画/水彩的色块感；与平滑后的图混合保留写实信息。"""
    if POSTERIZE_LEVELS < 2:
        return bgr
    step = 256.0 / POSTERIZE_LEVELS
    f = bgr.astype(np.float32)
    q = np.floor(f / step) * step + step * 0.5
    dither = (np.random.RandomState(5).rand(*f.shape[:2], 1) - 0.5) * step * 0.7
    q = np.clip(q + dither, 0, 255)
    out = f * (1 - POSTERIZE_STRENGTH) + q * POSTERIZE_STRENGTH
    return np.clip(out, 0, 255).astype(np.uint8)


def paper_blend(bgr: np.ndarray) -> np.ndarray:
    """纸纹理 soft 混合：向暖纸色（带微暗角与细颗粒）线性融合——"印在纸上"的质感。"""
    h, w = bgr.shape[:2]
    cx, cy = (w - 1) / 2, (h - 1) / 2
    xs = (np.arange(w) - cx) / max(1, w - 1)
    ys = (np.arange(h) - cy) / max(1, h - 1)
    d = np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2)
    vig = 1 - 0.08 * np.minimum(1, d * d)
    rng = np.random.RandomState(77)
    grain = (rng.rand(h, w) - 0.5) * 6
    paper = np.empty((h, w, 3), np.float32)
    paper[..., 0] = np.clip(248 * vig + grain, 0, 255)  # B
    paper[..., 1] = np.clip(243 * vig + grain, 0, 255)  # G
    paper[..., 2] = np.clip(237 * vig + grain, 0, 255)  # R（微暖偏）
    f = bgr.astype(np.float32)
    out = f * (1 - PAPER_BLEND) + paper * PAPER_BLEND
    return np.clip(out, 0, 255).astype(np.uint8)


def grain_overlay(bgr: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """纸纹叠加：细颗粒（确定性噪声）+ 宽向纤维条带（低频）。"""
    h, w = bgr.shape[:2]
    rng = np.random.RandomState(2026)
    fine = (rng.rand(h, w) - 0.5) * GRAIN * strength
    fiber = (rng.rand(h, 1) - 0.5) * FIBER * strength
    fiber = cv2.GaussianBlur(fiber, (0, 0), 4)
    noise = fine + np.broadcast_to(fiber, (h, w))
    out = bgr.astype(np.float32) + noise[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def stylize(bgr: np.ndarray, grain: float = 1.0) -> tuple:
    """侘寂纸感完整流程。返回 (styled_bgr, method)：method ∈ {'animegan-wabi', 'wabi-paper'}"""
    anime = animegan(bgr)
    if anime is not None:
        out = grade(anime)
        out = paper_blend(out)
        out = grain_overlay(out, grain)
        return out, 'animegan-wabi'
    out = grade(bgr)
    out = flatten(out)
    out = posterize(out)
    out = paper_blend(out)
    out = grain_overlay(out, grain)
    return out, 'wabi-paper'
