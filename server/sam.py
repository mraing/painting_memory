# SAM（Segment Anything，vit-base，ONNX 一体模型）自动分割：
# 7×7 正样本点网格批量提示 → 一次推理出全部候选 mask → 按 IoU/面积去重合并 → 精修。
# 与 FastSAM 相比：mask 完整、边界锐利（"物体没识别全/四分五裂"的根治方案）。
# 模型缺失/失败 → 返回 []，上层回退 FastSAM → 单主体（优雅降级链）。
import os
import threading

import cv2
import numpy as np

MODELS_DIR = os.environ.get('HUIYI_MODELS_DIR', os.path.join(os.path.dirname(__file__), 'models'))
SAM_URL = 'https://hf-mirror.com/Xenova/sam-vit-base/resolve/main/onnx/model_quantized.onnx'

IMG_SIZE = 1024
GRID = 4  # 4×4 = 16 个提示点（49→8.6s、25→6.7s、16→~5.5s；SAM 单点即可覆盖整物体）
MEAN = np.array([123.675, 116.28, 103.53], dtype=np.float32)
STD = np.array([58.395, 57.12, 57.375], dtype=np.float32)

_lock = threading.Lock()
_session = None
_error = None


def _load():
    global _session, _error
    if _session is not None or _error is not None:
        return
    with _lock:
        if _session is not None or _error is not None:
            return
        try:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = 4  # 限制单会话线程，避免多模型并行时争抢 CPU 核
            path = os.path.join(MODELS_DIR, 'sam_encoder_quant.onnx')
            if not os.path.exists(path):
                raise FileNotFoundError(f'SAM 模型缺失：{path}（可从 {SAM_URL} 下载）')
            _session = ort.InferenceSession(path, sess_options=so, providers=['CPUExecutionProvider'])
        except Exception as exc:
            _error = exc
            print(f'[sam] SAM 不可用（{exc}），回退 FastSAM')


def _preprocess(bgr: np.ndarray) -> tuple:
    """resize 长边 1024 → 居中补零 1024×1024 → ImageNet 归一化。返回 (tensor, scale, nw, nh)"""
    h, w = bgr.shape[:2]
    scale = IMG_SIZE / max(h, w)
    nh, nw = round(h * scale), round(w * scale)
    img = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
    img = (img - MEAN) / STD
    padded = np.zeros((IMG_SIZE, IMG_SIZE, 3), np.float32)
    padded[:nh, :nw] = img
    return padded.transpose(2, 0, 1)[None], scale, nw, nh


def _mask_to_image(mask256: np.ndarray, scale: float, nw: int, nh: int, w: int, h: int) -> np.ndarray:
    """256×256 mask → 1024 空间 → 裁掉补零区 → 缩放到原图尺寸"""
    m = cv2.resize(mask256, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_LINEAR)
    m = m[:nh, :nw]
    m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)
    _, m = cv2.threshold(m, 0.5, 255, cv2.THRESH_BINARY)
    return m.astype(np.uint8)


def _clean_mask(m: np.ndarray) -> np.ndarray:
    """SAM 粗 mask 清理：闭运算缝合 + 最大连通域（保留 ≥30% 卫星碎块）+ 边界平滑。
    （SAM 256×256 上采样后常有噪点碎块，不清理会"四分五裂"）"""
    k7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    closed = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k7)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(closed, 8)
    if num > 1:
        best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        best_area = int(stats[best, cv2.CC_STAT_AREA])
        keep = (labels == best).astype(np.uint8) * 255
        for i in range(1, num):
            if i != best and int(stats[i, cv2.CC_STAT_AREA]) >= 0.3 * best_area:
                keep = cv2.bitwise_or(keep, (labels == i).astype(np.uint8) * 255)
        m = keep
    m = cv2.GaussianBlur(m, (3, 3), 0)
    _, m = cv2.threshold(m, 127, 255, cv2.THRESH_BINARY)
    return m


def sam_instances(bgr: np.ndarray) -> list:
    """SAM 自动分割 → [{mask(原图尺寸 0/255), bbox, score}]（去重合并后）"""
    _load()
    if _session is None:
        return []
    h, w = bgr.shape[:2]
    padded, scale, nw, nh = _preprocess(bgr)

    ys = np.linspace(0, IMG_SIZE - 1, GRID, dtype=np.float32)
    xs = np.linspace(0, IMG_SIZE - 1, GRID, dtype=np.float32)
    points = np.stack(np.meshgrid(xs, ys), axis=-1).reshape(-1, 2)  # (49, 2)
    points = points[None, :, None, :]  # (1, 49, 1, 2)

    try:
        out = _session.run(None, {'pixel_values': padded, 'input_points': points})
    except Exception as exc:
        print(f'[sam] 推理失败（{exc}），回退 FastSAM')
        return []
    ious = out[0][0]      # (49, 3)
    masks = out[1][0]     # (49, 3, 256, 256)

    # 每个提示取 iou 最高的候选 mask
    best_idx = ious.argmax(axis=1)  # (49,)
    candidates = []
    for p in range(points.shape[1]):
        k = int(best_idx[p])
        iou = float(ious[p, k])
        if iou < 0.6:  # 低置信候选丢弃
            continue
        m = _mask_to_image(masks[p, k], scale, nw, nh, w, h)
        if (m > 0).mean() < 0.005:
            continue
        m = _clean_mask(m)
        if (m > 0).mean() < 0.005:
            continue
        ys_, xs_ = np.nonzero(m > 0)
        if xs_.size == 0:
            continue
        candidates.append({
            'mask': m,
            'bbox': (float(xs_.min()), float(ys_.min()), float(xs_.max()), float(ys_.max())),
            'score': iou,
        })

    # 去重合并：按面积降序，与已保留 mask 重叠（IoU>0.5 或 占小者>0.6）则跳过
    candidates.sort(key=lambda c: -(c['mask'] > 0).sum())
    kept = []
    for c in candidates:
        duplicate = False
        for kp in kept:
            inter = np.logical_and(c['mask'] > 0, kp['mask'] > 0).sum()
            small = min((c['mask'] > 0).sum(), (kp['mask'] > 0).sum())
            if small > 0 and inter / small > 0.6:
                duplicate = True
                break
        if not duplicate:
            kept.append(c)
    return kept
