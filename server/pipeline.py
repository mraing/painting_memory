# 绘忆 · 立绘管线（Python 后端，v3：侘寂纸感风格化 + 多元素前中后分层）
# 步骤：解码（EXIF 归一化）→ ≤768 降采样 → 侘寂纸感风格化（stylize.py，确定性）→
#       多元素分层（multilayer.py：FastSAM 实例分割 + Depth-Anything 深度排序 → 前/中/后带；
#       模型不可用 → 单主体回退：频谱残差显著性 + GrabCut）→
#       分层剪纸（纸缘/淡墨线/纸纹/投影）→ 配置 JSON。
# 全程内存态：不落盘、不留图（隐私承诺，见 development.md §5.4）。
import math
import time
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps

import stylize
import multilayer

PAPER_RGB = (244, 239, 230)  # --paper #F4EFE6
INK_RGB = (42, 37, 30)       # 淡墨线深棕
SHADOW_RGB = (40, 32, 22)    # 投影深棕
MAX_WORK = 768               # 工作图长边

CENTER_FALLBACK_BBOX = (0.225, 0.225, 0.55, 0.55)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ---------- 解码 ----------

def decode(data: bytes) -> np.ndarray:
    """解码 + EXIF 方向归一化 + 降采样 ≤768 → BGR ndarray（工作尺寸）。"""
    try:
        img = Image.open(BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img = img.convert('RGB')
    except Exception as exc:
        raise ValueError('无法解码照片（仅支持 JPEG/PNG/WebP/BMP/GIF）') from exc
    w, h = img.size
    long_side = max(w, h)
    scale = min(1.0, MAX_WORK / long_side) if long_side > 0 else 1.0
    rgb = np.asarray(img)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    if scale < 1:
        bgr = cv2.resize(
            bgr,
            (max(1, round(w * scale)), max(1, round(h * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return bgr


# ---------- 显著性（单主体回退路径，与 v2 一致） ----------

def _gauss_smooth(src: np.ndarray, sigma: float) -> np.ndarray:
    r = int(math.ceil(sigma * 2.5))
    ys, xs = np.mgrid[-r : r + 1, -r : r + 1]
    kernel = np.exp(-(xs * xs + ys * ys) / (2 * sigma * sigma))
    kernel = kernel / kernel.sum()
    return cv2.filter2D(src.astype(np.float64), -1, kernel, borderType=cv2.BORDER_REPLICATE)


def _hann2d(w: int, h: int) -> np.ndarray:
    wy = 0.5 * (1 - np.cos(2 * np.pi * np.arange(h) / (h - 1)))
    wx = 0.5 * (1 - np.cos(2 * np.pi * np.arange(w) / (w - 1)))
    return np.outer(wy, wx)


def spectral_residual_saliency(gray: np.ndarray) -> np.ndarray:
    g = gray.astype(np.float64)
    h, w = g.shape
    re = (g - g.mean()) * _hann2d(w, h)
    f = np.fft.fft2(re)
    log_amp = np.log(np.abs(f) + 1e-8)
    phase = np.angle(f)
    residual = log_amp - _gauss_smooth(log_amp, 2)
    back = np.fft.ifft2(np.exp(residual) * np.exp(1j * phase))
    energy = np.abs(back) ** 2
    mn, mx = float(energy.min()), float(energy.max())
    m = (energy - mn) / (mx - mn) if mx - mn > 1e-12 else np.zeros_like(energy)
    return _gauss_smooth(m, 1.5)


def color_contrast_saliency(rgb: np.ndarray) -> np.ndarray:
    mean = rgb.reshape(-1, 3).mean(axis=0)
    raw = np.linalg.norm(rgb - mean, axis=2)
    mx = float(raw.max())
    m = raw / mx if mx > 1e-9 else raw
    return _gauss_smooth(m, 1)


def otsu_threshold(values: np.ndarray) -> float:
    hist = np.bincount(
        np.clip(np.round(values.ravel() * 255).astype(np.int64), 0, 255), minlength=256
    ).astype(np.float64)
    total = float(values.size)
    sum_all = float(np.arange(256) @ hist)
    w_b = 0.0
    sum_b = 0.0
    max_var = -1.0
    best = 127
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        between = w_b * w_f * (m_b - m_f) * (m_b - m_f)
        if between > max_var:
            max_var = between
            best = t
    return best / 255


def locate_subject(sal: np.ndarray) -> dict:
    h, w = sal.shape
    n = w * h
    max_v = float(sal.max())

    def fallback():
        return {
            'bbox': {'x': CENTER_FALLBACK_BBOX[0], 'y': CENTER_FALLBACK_BBOX[1],
                     'w': CENTER_FALLBACK_BBOX[2], 'h': CENTER_FALLBACK_BBOX[3]},
            'coverage': 0.3025, 'score': max_v,
            'method': 'heuristic-center', 'usedFallback': True,
        }

    if max_v < 0.2:
        return fallback()
    threshold = max(otsu_threshold(sal), 0.35 * max_v)
    binary = (sal >= threshold).astype(np.uint8)
    binary = cv2.dilate(binary, np.ones((3, 3), np.uint8))
    num, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if num <= 1:
        return fallback()
    sizes = stats[1:, cv2.CC_STAT_AREA]
    best = int(sizes.argmax()) + 1
    size = int(sizes[best - 1])
    if size / n < 0.02:
        return fallback()
    x, y, ww, hh = (
        int(stats[best, cv2.CC_STAT_LEFT]), int(stats[best, cv2.CC_STAT_TOP]),
        int(stats[best, cv2.CC_STAT_WIDTH]), int(stats[best, cv2.CC_STAT_HEIGHT]),
    )
    score = min(1.0, float(sal[y : y + hh, x : x + ww].mean()))
    return {
        'bbox': {'x': x / w, 'y': y / h, 'w': ww / w, 'h': hh / h},
        'coverage': size / n, 'score': score,
        'method': 'contrast-sr', 'usedFallback': False,
    }


def to_work_rect(bbox: dict, w: int, h: int) -> tuple:
    pad_x = bbox['w'] * 0.1
    pad_y = bbox['h'] * 0.1
    x = round((bbox['x'] - pad_x) * w)
    y = round((bbox['y'] - pad_y) * h)
    rw = round((bbox['w'] + pad_x * 2) * w)
    rh = round((bbox['h'] + pad_y * 2) * h)
    cx = _clamp(x, 0, max(0, w - 1))
    cy = _clamp(y, 0, max(0, h - 1))
    min_size = min(8, w, h)
    cw = _clamp(max(rw, min_size), 1, w - cx)
    ch = _clamp(max(rh, min_size), 1, h - cy)
    return (round(cx), round(cy), round(cw), round(ch))


def grabcut_mask(bgr: np.ndarray, rect: tuple) -> dict:
    h, w = bgr.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, rect, bgd, fgd, 2, cv2.GC_INIT_WITH_RECT)
    fg_mask = np.where((mask & 1) > 0, 255, 0).astype(np.uint8)
    opened = cv2.morphologyEx(
        fg_mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    )
    num, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    best, best_area = -1, 0
    for i in range(1, num):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area > best_area:
            best_area = area
            best = i
    out = np.zeros((h, w), np.uint8)
    if best > 0:
        eq = (labels == best).astype(np.uint8) * 255
        out = cv2.dilate(
            eq, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=2
        )
    coverage = best_area / (w * h)
    return {'mask': out, 'coverage': coverage, 'ok': best > 0 and coverage >= 0.02}


def fallback_ellipse_mask(h: int, w: int) -> np.ndarray:
    mask = np.zeros((h, w), np.uint8)
    cv2.ellipse(
        mask,
        (round(w / 2), round(h / 2)),
        (max(1, round(w * 0.3)), max(1, round(h * 0.3))),
        0, 0, 360, 255, -1,
    )
    return mask


# ---------- 分层（元素剪纸 / 背景 / 纸底 / 投影） ----------

def build_bg(bgr: np.ndarray) -> tuple:
    """插画化背景：半分辨率 σ14 模糊（≈ 全分辨率 σ28）+ 55% 纸色 + 45% 去饱和（纯填充）。
    返回 (BGR, bgTint)"""
    h, w = bgr.shape[:2]
    half = cv2.resize(bgr, (max(1, w >> 1), max(1, h >> 1)), interpolation=cv2.INTER_AREA)
    blur_half = cv2.GaussianBlur(half, (0, 0), 14)
    blur = cv2.resize(blur_half, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    paper = np.array(PAPER_RGB, np.float32)
    xr = blur[..., 2] * 0.45 + paper[0] * 0.55
    xg = blur[..., 1] * 0.45 + paper[1] * 0.55
    xb = blur[..., 0] * 0.45 + paper[2] * 0.55
    b_gray = 0.299 * xr + 0.587 * xg + 0.114 * xb
    xr = xr * 0.55 + b_gray * 0.45
    xg = xg * 0.55 + b_gray * 0.45
    xb = xb * 0.55 + b_gray * 0.45
    bg = np.dstack([np.clip(xb, 0, 255), np.clip(xg, 0, 255), np.clip(xr, 0, 255)]).astype(np.uint8)
    tint = (round(float(xr.mean())), round(float(xg.mean())), round(float(xb.mean())))
    return bg, tint


def build_element(bgr: np.ndarray, mask: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """单元素剪纸层（BGRA）：alpha 高斯软边 + 纸缘 2px/60% 纸色 + Canny 淡墨线 + 8% 去饱和 + 纸纹颗粒"""
    h, w = bgr.shape[:2]
    alpha = cv2.GaussianBlur(mask, (7, 7), 1.6).astype(np.float32)
    dk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    dilated = cv2.dilate(mask, dk, iterations=2)
    rim = cv2.bitwise_and(dilated, cv2.bitwise_not(mask)) > 0
    edges = cv2.dilate(cv2.Canny(gray, 60, 160), dk, iterations=1)
    ink = cv2.bitwise_and(edges, dilated) > 0

    b_ch = bgr[..., 0].astype(np.float32)
    g_ch = bgr[..., 1].astype(np.float32)
    r_ch = bgr[..., 2].astype(np.float32)
    paper = np.array(PAPER_RGB, np.float32)
    fr, fg_, fb = r_ch.copy(), g_ch.copy(), b_ch.copy()
    fr = np.where(rim, r_ch * 0.4 + paper[0] * 0.6, fr)
    fg_ = np.where(rim, g_ch * 0.4 + paper[1] * 0.6, fg_)
    fb = np.where(rim, b_ch * 0.4 + paper[2] * 0.6, fb)
    ink_c = np.array(INK_RGB, np.float32)
    fr = np.where(ink, fr * 0.5 + ink_c[0] * 0.5, fr)
    fg_ = np.where(ink, fg_ * 0.5 + ink_c[1] * 0.5, fg_)
    fb = np.where(ink, fb * 0.5 + ink_c[2] * 0.5, fb)
    gray_v = 0.299 * fr + 0.587 * fg_ + 0.114 * fb
    noise = (np.random.RandomState(11).rand(h, w) - 0.5) * 10
    fr = np.clip(fr * 0.92 + gray_v * 0.08 + noise, 0, 255)
    fg_ = np.clip(fg_ * 0.92 + gray_v * 0.08 + noise, 0, 255)
    fb = np.clip(fb * 0.92 + gray_v * 0.08 + noise, 0, 255)
    fa = alpha.copy()
    fa = np.maximum(fa, np.where(rim, 220, 0))
    fa = np.maximum(fa, np.where(ink, 210, 0))
    return np.dstack([fb, fg_, fr, fa]).astype(np.uint8)


def make_paper_layer(w: int, h: int, seed: int = 7) -> np.ndarray:
    cx, cy = (w - 1) / 2, (h - 1) / 2
    xs = (np.arange(w) - cx) / max(1, w - 1)
    ys = (np.arange(h) - cy) / max(1, h - 1)
    d = np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2)
    vig = 1 - 0.1 * np.minimum(1, d * d)
    noise = (np.random.RandomState(seed).rand(h, w) - 0.5) * 7
    r = np.clip(np.round(PAPER_RGB[0] * vig + noise), 0, 255)
    g = np.clip(np.round(PAPER_RGB[1] * vig + noise), 0, 255)
    b = np.clip(np.round(PAPER_RGB[2] * vig + noise), 0, 255)
    return np.dstack([b, g, r]).astype(np.uint8)


def make_shadow_layer(mask: np.ndarray, w: int, h: int) -> np.ndarray:
    blurred = cv2.GaussianBlur(mask, (0, 0), 8).astype(np.float32)
    dx = max(2, round(w * 0.015))
    dy = max(2, round(h * 0.012))
    alpha = np.zeros((h, w), np.float32)
    alpha[dy:, dx:] = blurred[: h - dy, : w - dx] * (116 / 255)
    alpha = np.clip(alpha, 0, 255)
    r = np.full((h, w), SHADOW_RGB[0], np.float32)
    g = np.full((h, w), SHADOW_RGB[1], np.float32)
    b = np.full((h, w), SHADOW_RGB[2], np.float32)
    return np.dstack([b, g, r, alpha]).astype(np.uint8)


def subject_main_color(bgr: np.ndarray, mask: np.ndarray) -> dict:
    sel = mask > 0
    if not sel.any():
        return {'r': 128, 'g': 128, 'b': 128}
    b, g, r = (bgr[..., i][sel].mean() for i in range(3))
    return {'r': round(float(r)), 'g': round(float(g)), 'b': round(float(b))}


# ---------- 单主体回退 ----------

def single_subject(bgr: np.ndarray, gray: np.ndarray) -> dict:
    """显著性 + GrabCut → 单一 front mask（返回 segment_bands 同构）"""
    h, w = bgr.shape[:2]
    raw_map = min(64, min(w, h))
    map_c = max(2, 1 << int(math.floor(math.log2(raw_map))))
    small_gray = cv2.resize(gray, (map_c, map_c), interpolation=cv2.INTER_AREA)
    small_rgb = cv2.resize(bgr, (map_c, map_c), interpolation=cv2.INTER_AREA)
    small_rgb = cv2.cvtColor(small_rgb, cv2.COLOR_BGR2RGB)
    cc = color_contrast_saliency(small_rgb.astype(np.float64) / 255.0)
    sr = spectral_residual_saliency(small_gray.astype(np.float64) / 255.0)
    comb = np.maximum(cc, 0.5 * sr)
    loc = locate_subject(comb)

    rect = to_work_rect(loc['bbox'], w, h)
    mask_res = None
    try:
        mask_res = grabcut_mask(bgr, rect)
    except Exception:
        mask_res = None
    used_fallback = loc['usedFallback']
    if mask_res is None or not mask_res['ok']:
        mask = fallback_ellipse_mask(h, w)
        coverage = float((mask > 0).mean())
        mask_res = {'mask': mask, 'coverage': coverage, 'ok': True}
        used_fallback = True
    meta = [{'band': 'front', 'score': round(loc['score'], 2), 'bbox': loc['bbox']}]
    return {
        'front': mask_res['mask'], 'mid': None, 'back': None,
        'meta': meta, 'usedFallback': used_fallback,
        'method': loc['method'], 'score': loc['score'],
        'coverage': mask_res['coverage'],
    }


# ---------- 主入口 ----------

def run_pipeline(data: bytes) -> dict:
    t0 = time.perf_counter()
    bgr = decode(data)
    t_decode = time.perf_counter()
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # ① 分割：在**原图**上进行（风格化会破坏分割所需的纹理/边缘信息）：
    #    SAM（完整 mask）→ FastSAM → 单主体显著性，逐级降级
    # ② 风格化：原图 → AnimeGAN 插画化 → 侘寂后处理（确定性回退链）
    # 两者互不依赖 → 并行执行（SAM/AnimeGAN 均为 CPU 推理，线程并行显著省时）
    from concurrent.futures import ThreadPoolExecutor

    def _do_seg():
        try:
            bands = multilayer.segment_bands(bgr)
        except Exception as exc:
            print(f'[pipeline] 多元素分层异常（{exc}），回退单主体')
            return None
        if bands is not None:
            bands['usedFallback'] = False
            bands['score'] = max((m['score'] for m in bands['meta']), default=0.5)
            bands['coverage'] = float((bands['front'] > 0).mean())
            bands['method'] = bands.get('method', 'sam-depth')
            return bands
        return single_subject(bgr, gray)

    with ThreadPoolExecutor(max_workers=2) as ex:
        seg_fut = ex.submit(_do_seg)
        t_st0 = time.perf_counter()
        styled, style_method = stylize.stylize(bgr)
        t_st1 = time.perf_counter()
        seg = seg_fut.result()
    t_seg = time.perf_counter()

    gray_s = cv2.cvtColor(styled, cv2.COLOR_BGR2GRAY)

    # ③ 分层剪纸：mask 来自原图分割，像素来自风格化图
    union_mask = np.zeros((h, w), np.uint8)
    for band_mask in (seg['front'], seg['mid'], seg['back']):
        if band_mask is not None:
            union_mask = cv2.bitwise_or(union_mask, band_mask)
    bg_src = styled
    if (union_mask > 0).any():
        bg_src = cv2.inpaint(styled, union_mask, 3, cv2.INPAINT_TELEA)
    bg, bg_tint = build_bg(bg_src)
    front_elem = build_element(styled, seg['front'], gray_s)
    mid_elem = build_element(styled, seg['mid'], gray_s) if seg['mid'] is not None else None
    back_elem = build_element(styled, seg['back'], gray_s) if seg['back'] is not None else None
    shadow = make_shadow_layer(seg['front'], w, h)
    base = make_paper_layer(w, h)

    pngs = {'foreground': _png(front_elem), 'background': _png(bg), 'base': _png(base), 'shadow': _png(shadow)}
    if mid_elem is not None:
        pngs['midground'] = _png(mid_elem)
    if back_elem is not None:
        pngs['backdrop'] = _png(back_elem)
    t_layers = time.perf_counter()

    main_color = subject_main_color(styled, seg['front'])
    depth = round(_clamp(0.25 + seg['coverage'] * 1.3 + seg['score'] * 0.35, 0.2, 0.95), 2)
    config = {
        'version': 1,
        'workSize': {'width': w, 'height': h},
        'subjectBBox': next((m['bbox'] for m in seg['meta'] if m['band'] == 'front'), None),
        'mainColor': main_color,
        'palette': {
            'paper': {'r': PAPER_RGB[0], 'g': PAPER_RGB[1], 'b': PAPER_RGB[2]},
            'bgTint': {'r': bg_tint[0], 'g': bg_tint[1], 'b': bg_tint[2]},
        },
        'depth': depth,
        'maskCoverage': round(seg['coverage'], 3),
        'usedFallback': seg['usedFallback'],
        'saliency': {'method': seg['method'], 'score': round(seg['score'], 2)},
        'layers': seg['meta'],
        'style': {'method': style_method, 'flatten': True, 'posterize': style_method == 'wabi-paper', 'grain': 1.0},
        'timingMs': {
            'decode': round((t_decode - t0) * 1000),
            'seg': round((t_seg - t_decode) * 1000),
            'stylize': round((t_st1 - t_st0) * 1000),
            'layers': round((t_layers - t_seg) * 1000),
            'total': round((time.perf_counter() - t0) * 1000),
        },
    }
    return {**pngs, 'config': config}


def _png(arr: np.ndarray) -> bytes:
    return cv2.imencode('.png', arr)[1].tobytes()
