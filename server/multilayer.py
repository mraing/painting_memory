# 多元素前中后分层（FastSAM 实例分割 + Depth-Anything-v2 深度排序）
# 模型（ONNX，首次运行自动从镜像下载或置于 models/）：
#   - FastSAM_S.onnx（47MB，实例分割，640 输入）
#   - depth_anything_v2_small_quant.onnx（27MB，单目深度）
# 分层规则：实例按 mask 内中位深度排序 → 前/中/后三个深度带（≤2 个实例时合并为前/后）。
# 任一模型缺失/加载失败 → 返回 None，上层回退单主体管线（优雅降级）。
import math
import os
import threading

import cv2
import numpy as np

import sam

MODELS_DIR = os.environ.get('HUIYI_MODELS_DIR', os.path.join(os.path.dirname(__file__), 'models'))

FASTSAM_URL = 'https://raw.githubusercontent.com/cqu20160901/FastSAM_onnx_rknn/main/FastSAM_onnx/FastSAM_S.onnx'
DAV2_URL = 'https://hf-mirror.com/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx'

# GitHub 下载镜像列表（raw 在国内/受限网络较慢，依次尝试；可用 HUIYI_GITHUB_MIRROR 覆盖为直连）
GITHUB_MIRRORS = [
    os.environ.get('HUIYI_GITHUB_MIRROR'),
    'https://gh-proxy.com/https://raw.githubusercontent.com',
    'https://ghproxy.net/https://raw.githubusercontent.com',
    'https://ghfast.top/https://raw.githubusercontent.com',
    'https://raw.githubusercontent.com',
]
GITHUB_MIRRORS = [m for m in GITHUB_MIRRORS if m]

FASTSAM_SIZE = 640
OBJ_THRESH = 0.2     # 中等阈值：宁多勿漏，但避免大量碎响应（靠合并与精修收尾）
NMS_THRESH = 0.45
MASK_THRESH = 0.35   # 低 mask 阈值 → mask 更饱满（粗 proto 上 0.5 会把物体切碎）
STRIDES = (8, 16, 32)
MAP_SIZES = ((80, 80), (40, 40), (20, 20))
HEAD_NUM = 3
DFL_NUM = 16
MASK_NUM = 32

# —— 模型加载（进程内单例 + 懒加载）——

_lock = threading.Lock()
_seg_session = None
_depth_session = None
_seg_error = None
_depth_error = None


def _download(url: str, dest: str) -> None:
    """下载模型：GitHub raw 走镜像列表，其余（HF 镜像）直连；全部失败抛错（上层降级回退）。"""
    import urllib.request

    errors = []
    candidates = (
        [f'{m}/{url.split("/raw.githubusercontent.com/")[-1]}' for m in GITHUB_MIRRORS]
        if 'raw.githubusercontent.com' in url
        else [url]
    )
    for full in candidates:
        try:
            print(f'[multilayer] 下载模型 {dest}（{full}）…')
            urllib.request.urlretrieve(full, dest)
            if os.path.getsize(dest) > 1_000_000:
                return
        except Exception as exc:
            errors.append(f'{full}: {exc}')
    raise RuntimeError('模型下载失败：' + '; '.join(errors))


def _load_seg():
    global _seg_session, _seg_error
    if _seg_session is not None or _seg_error is not None:
        return
    with _lock:
        if _seg_session is not None or _seg_error is not None:
            return
        try:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = 4  # 限制单会话线程，避免多模型并行时争抢 CPU 核
            path = os.path.join(MODELS_DIR, 'FastSAM_S.onnx')
            if not os.path.exists(path):
                _download(FASTSAM_URL, path)
            _seg_session = ort.InferenceSession(path, sess_options=so, providers=['CPUExecutionProvider'])
        except Exception as exc:  # 模型缺失/下载失败/推理库缺失
            _seg_error = exc
            print(f'[multilayer] FastSAM 不可用（{exc}），回退单主体管线')


def _load_depth():
    global _depth_session, _depth_error
    if _depth_session is not None or _depth_error is not None:
        return
    with _lock:
        if _depth_session is not None or _depth_error is not None:
            return
        try:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = 4  # 限制单会话线程，避免多模型并行时争抢 CPU 核
            path = os.path.join(MODELS_DIR, 'depth_anything_v2_small_quant.onnx')
            if not os.path.exists(path):
                _download(DAV2_URL, path)
            _depth_session = ort.InferenceSession(path, sess_options=so, providers=['CPUExecutionProvider'])
        except Exception as exc:
            _depth_error = exc
            print(f'[multilayer] 深度模型不可用（{exc}），深度排序将退化为画面位置启发式')


# —— FastSAM 推理与解码（移植官方 demo，向量化）——

def _generate_meshgrid() -> np.ndarray:
    grids = []
    for (mh, mw) in MAP_SIZES:
        ys, xs = np.mgrid[0:mh, 0:mw]
        grids.append(np.stack([xs + 0.5, ys + 0.5], axis=-1).reshape(-1, 2))
    return np.concatenate(grids, axis=0)  # (8400, 2)


_MESH = _generate_meshgrid()


def _softmax16(x: np.ndarray) -> np.ndarray:
    """DFL 分布：x: (N,4,16) → (N,4) 加权位置"""
    e = np.exp(x - x.max(axis=2, keepdims=True))
    p = e / e.sum(axis=2, keepdims=True)
    return (p * np.arange(16, dtype=np.float32)).sum(axis=2)


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float) -> np.ndarray:
    """boxes: (N,4) xyxy；返回保留索引"""
    order = np.argsort(-scores)
    keep = []
    xs1, ys1, xs2, ys2 = boxes.T
    areas = (xs2 - xs1) * (ys2 - ys1)
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(xs1[i], xs1[order[1:]])
        yy1 = np.maximum(ys1[i], ys1[order[1:]])
        xx2 = np.minimum(xs2[i], xs2[order[1:]])
        yy2 = np.minimum(ys2[i], ys2[order[1:]])
        w = np.maximum(0, xx2 - xx1)
        h = np.maximum(0, yy2 - yy1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)
        order = order[1:][iou <= iou_thresh]
    return np.array(keep, dtype=np.int64)


def _refine_instance(bgr: np.ndarray, inst: dict) -> dict:
    """实例 mask 精修（解决"图层破碎/锯齿"）：
    ① 闭运算（7×7）合并碎块、填小孔；② 最大连通域（保留 ≥30% 主体面积的卫星碎块）；
    ③ 边界粗糙实例 → GrabCut（mask 先验，**半分辨率执行**，边缘带为不确定区）精修出完整锐利边界；
    ④ 边界平滑。"""
    m = inst['mask']
    h, w = m.shape[:2]
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    closed = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)

    num, labels, stats, _ = cv2.connectedComponentsWithStats(closed, 8)
    if num > 1:
        best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        best_area = int(stats[best, cv2.CC_STAT_AREA])
        keep = (labels == best).astype(np.uint8) * 255
        for i in range(1, num):
            if i != best and int(stats[i, cv2.CC_STAT_AREA]) >= 0.3 * best_area:
                keep = cv2.bitwise_or(keep, (labels == i).astype(np.uint8) * 255)
        m = keep

    # 粗糙度启发：周长/面积比（圆 = 1）；过粗才走 GrabCut（省时）
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = float((m > 0).sum())
    if area > 0:
        perim = sum(cv2.arcLength(c, True) for c in cnts)
        roughness = perim / (2 * np.sqrt(np.pi * area))
        if roughness > 1.45 and area > (h * w) * 0.01:
            # 半分辨率 GrabCut（4 倍提速，边界精度经放大+平滑后视觉等价）
            small = cv2.resize(bgr, (max(1, w >> 1), max(1, h >> 1)), interpolation=cv2.INTER_AREA)
            sm = cv2.resize(m, (max(1, w >> 1), max(1, h >> 1)), interpolation=cv2.INTER_NEAREST)
            bgd = np.zeros((1, 65), np.float64)
            fgd = np.zeros((1, 65), np.float64)
            gm = np.zeros((small.shape[0], small.shape[1]), np.uint8)
            gm[sm > 0] = 1  # 确定前景
            dk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            uncertain = cv2.bitwise_xor(
                cv2.dilate(sm, dk, iterations=1), cv2.erode(sm, dk, iterations=1)
            )
            gm[uncertain > 0] = 2  # 可能背景 → GrabCut 自由判定边界
            try:
                cv2.grabCut(small, gm, None, bgd, fgd, 2, cv2.GC_INIT_WITH_MASK)
                refined = np.where((gm & 1) > 0, 255, 0).astype(np.uint8)
                refined = cv2.resize(refined, (w, h), interpolation=cv2.INTER_LINEAR)
                _, refined = cv2.threshold(refined, 127, 255, cv2.THRESH_BINARY)
                if (refined > 0).mean() > 0.002:
                    m = refined
            except Exception:
                pass

    # 边界平滑
    m = cv2.GaussianBlur(m, (3, 3), 0)
    _, m = cv2.threshold(m, 127, 255, cv2.THRESH_BINARY)
    inst['mask'] = m
    return inst


def fastsam_instances(bgr: np.ndarray) -> list:
    """FastSAM 实例分割 → [{mask(原图尺寸 uint8 0/255), bbox(xyxy), score}]"""
    _load_seg()
    if _seg_session is None:
        return []
    img_h, img_w = bgr.shape[:2]
    resized = cv2.resize(bgr, (FASTSAM_SIZE, FASTSAM_SIZE), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    inp = rgb.transpose(2, 0, 1)[None]
    outs_raw = _seg_session.run(None, {'data': inp})
    outs = [o.reshape(-1) for o in outs_raw]
    proto = outs_raw[9][0]  # (32,160,160)

    scale_w, scale_h = img_w / FASTSAM_SIZE, img_h / FASTSAM_SIZE
    grid_i = 0
    detections = []  # (score, box_xyxy_img, mask_coeffs)
    for hi in range(HEAD_NUM):
        mh, mw = MAP_SIZES[hi]
        reg = outs[hi * 2].reshape(4 * DFL_NUM, mh * mw)
        cls = outs[hi * 2 + 1].reshape(1, mh * mw)
        msk = outs[HEAD_NUM * 2 + hi].reshape(MASK_NUM, mh * mw)
        cls_s = 1.0 / (1.0 + np.exp(-cls[0]))
        grid = _MESH[grid_i : grid_i + mh * mw]
        grid_i += mh * mw
        cand = np.nonzero(cls_s > OBJ_THRESH)[0]
        if cand.size == 0:
            continue
        dfl = _softmax16(reg[:, cand].T.reshape(-1, 4, DFL_NUM))  # (K,4)
        cx = grid[cand, 0]
        cy = grid[cand, 1]
        x1 = (cx - dfl[:, 0]) * STRIDES[hi]
        y1 = (cy - dfl[:, 1]) * STRIDES[hi]
        x2 = (cx + dfl[:, 2]) * STRIDES[hi]
        y2 = (cy + dfl[:, 3]) * STRIDES[hi]
        for k in range(cand.size):
            detections.append(
                (
                    float(cls_s[cand[k]]),
                    (x1[k], y1[k], x2[k], y2[k]),
                    msk[:, cand[k]].copy(),
                )
            )
    if not detections:
        return []

    scores = np.array([d[0] for d in detections], dtype=np.float32)
    boxes = np.array([d[1] for d in detections], dtype=np.float32)
    keep = _nms(boxes, scores, NMS_THRESH)

    # mask 解码：sigmoid(coeffs @ proto) → 160×160 → 放大到原图。
    # 关键：裁剪框外扩 12% 再裁（FastSAM 预测 mask 常超出检测框，按框裁剪会把物体切碎）
    ph, pw = proto.shape[1:]
    pending = []
    for idx in keep:
        score = scores[idx]
        x1, y1, x2, y2 = boxes[idx]
        coeffs = np.array(detections[idx][2], dtype=np.float32)
        mask_small = 1.0 / (1.0 + np.exp(-(coeffs @ proto.reshape(32, -1))))
        mask_small = mask_small.reshape(ph, pw)
        pad_x = (x2 - x1) * 0.12
        pad_y = (y2 - y1) * 0.12
        bx1 = int(np.clip((x1 - pad_x) / FASTSAM_SIZE * pw, 0, pw - 1))
        by1 = int(np.clip((y1 - pad_y) / FASTSAM_SIZE * ph, 0, ph - 1))
        bx2 = int(np.clip((x2 + pad_x) / FASTSAM_SIZE * pw, 0, pw))
        by2 = int(np.clip((y2 + pad_y) / FASTSAM_SIZE * ph, 0, ph))
        crop = np.zeros((ph, pw), np.float32)
        crop[by1:by2, bx1:bx2] = mask_small[by1:by2, bx1:bx2]
        crop = (crop > MASK_THRESH).astype(np.uint8) * 255
        # 闭运算缝合 mask 内细小断裂
        crop = cv2.morphologyEx(
            crop, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        )
        crop = cv2.resize(crop, (img_w, img_h), interpolation=cv2.INTER_LINEAR)
        _, crop = cv2.threshold(crop, 127, 255, cv2.THRESH_BINARY)
        # 主体像素占比过小则丢弃
        if (crop > 0).mean() < 0.005:
            continue
        pending.append({'mask': crop, 'bbox': (x1, y1, x2, y2), 'score': score})

    # 逐实例精修（GrabCut 释放 GIL → 线程并行）
    if len(pending) > 1:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=min(4, len(pending))) as ex:
            results = list(ex.map(lambda inst: _refine_instance(bgr, inst), pending))
    else:
        results = [_refine_instance(bgr, inst) for inst in pending]
    return results


# —— 深度估计 ——

def depth_map(bgr: np.ndarray) -> np.ndarray | None:
    """单目深度图（越大 = 越近，归一化 0..1）；模型不可用时返回 None"""
    _load_depth()
    if _depth_session is None:
        return None
    h, w = bgr.shape[:2]
    # DAv2 标准预处理：长边 518（对齐 14 的倍数），ImageNet 归一化
    long_side = max(h, w)
    scale = 518 / long_side
    nh, nw = int(round(h * scale / 14) * 14), int(round(w * scale / 14) * 14)
    img = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    img = (img - mean) / std
    out = _depth_session.run(None, {'pixel_values': img.transpose(2, 0, 1)[None]})[0]
    dep = out[0]  # (dh, dw)
    dep = cv2.resize(dep, (w, h), interpolation=cv2.INTER_LINEAR)
    dmin, dmax = float(dep.min()), float(dep.max())
    if dmax - dmin < 1e-6:
        return None
    norm = (dep - dmin) / (dmax - dmin)
    return norm  # 约定：值越大 = 越近（若实测相反，在 _BANDS 排序处翻转）


# —— 分层 ——

FRONT, MID, BACK = 'front', 'mid', 'back'


def _band_assign(depth_medians: list, n: int) -> list:
    """把按深度排序的实例下标分到前/中/后带。depth_medians 升序（近→远）"""
    if n <= 1:
        return [FRONT] * n
    if n == 2:
        return [FRONT, BACK]
    q1 = max(1, n // 3)
    bands = []
    for i in range(n):
        if i < q1:
            bands.append(FRONT)
        elif i < q1 * 2:
            bands.append(MID)
        else:
            bands.append(BACK)
    return bands


def _color_hist(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """实例区域 BGR 直方图（8 桶 × 3 通道，归一化），用于碎片相似度判断"""
    h, w = bgr.shape[:2]
    m = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST) > 0
    if not m.any():
        return np.zeros(24, np.float32)
    px = bgr[m]
    hist = np.zeros(24, np.float32)
    for c in range(3):
        bins = np.clip((px[:, c] // 32).astype(np.int32), 0, 7)
        hist[c * 8 : (c + 1) * 8] = np.bincount(bins, minlength=8).astype(np.float32)
    s = hist.sum()
    return hist / s if s > 0 else hist


def _merge_fragments(bgr: np.ndarray, instances: list, dep: np.ndarray | None) -> list:
    """合并同一物体的碎片：两两满足 中心距 < 12% 对角线 且 颜色直方图相关 > 0.7
    且 深度中位数差 < 0.15 → 并集 + 精修为一个实例。"""
    if len(instances) <= 1:
        return instances
    h, w = bgr.shape[:2]
    diag = math.hypot(w, h)

    def center(inst):
        ys, xs = np.nonzero(inst['mask'] > 0)
        return (float(xs.mean()), float(ys.mean())) if xs.size else (0.0, 0.0)

    def median_depth(inst):
        if dep is None:
            return None
        m = inst['mask'] > 0
        return float(np.median(dep[m])) if m.any() else None

    centers = [center(i) for i in instances]
    hists = [_color_hist(bgr, i['mask']) for i in instances]
    meds = [median_depth(i) for i in instances]

    n = len(instances)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            d = math.dist(centers[i], centers[j])
            if d > diag * 0.12:
                continue
            corr = float(np.corrcoef(hists[i], hists[j])[0, 1]) if hists[i].sum() and hists[j].sum() else 0.0
            if corr < 0.7:
                continue
            if meds[i] is not None and meds[j] is not None and abs(meds[i] - meds[j]) > 0.15:
                continue
            union(i, j)

    groups: dict = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    merged = []
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    for members in groups.values():
        if len(members) == 1:
            merged.append(instances[members[0]])
            continue
        union_mask = np.zeros((h, w), np.uint8)
        for i in members:
            union_mask = cv2.bitwise_or(union_mask, instances[i]['mask'])
        union_mask = cv2.morphologyEx(union_mask, cv2.MORPH_CLOSE, kernel)
        num, labels, stats, _ = cv2.connectedComponentsWithStats(union_mask, 8)
        best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        best_area = int(stats[best, cv2.CC_STAT_AREA])
        keep = (labels == best).astype(np.uint8) * 255
        for i in range(1, num):
            if i != best and int(stats[i, cv2.CC_STAT_AREA]) >= 0.3 * best_area:
                keep = cv2.bitwise_or(keep, (labels == i).astype(np.uint8) * 255)
        xs, ys = np.nonzero(keep > 0)
        box = (float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())) if xs.size else (0, 0, 0, 0)
        merged.append({
            'mask': keep,
            'bbox': box,
            'score': max(instances[i]['score'] for i in members),
        })
    return merged


_last_source = 'fastsam'  # 最近一次实例分割来源（sam / fastsam），用于 config.saliency.method
# 分割器选择：默认 fastsam（~2s，Intel CPU 实测足够）；HUIYI_SEGMENTOR=sam 切 SAM 质量档
# （~10s，mask 更完整锐利，对"物体没识别全"要求高的场景使用）
_SEGMENTOR = os.environ.get('HUIYI_SEGMENTOR', 'fastsam')


def _get_instances(bgr: np.ndarray) -> list:
    """实例分割（降级链）：按 HUIYI_SEGMENTOR 选主分割器，失败回退另一条 → []（回退单主体）"""
    global _last_source
    if _SEGMENTOR == 'sam':
        insts = sam.sam_instances(bgr)
        if insts:
            _last_source = 'sam'
            return insts
    insts = fastsam_instances(bgr)
    if insts:
        _last_source = 'fastsam'
        return insts
    if _SEGMENTOR == 'sam':
        insts = sam.sam_instances(bgr)
        if insts:
            _last_source = 'sam'
            return insts
    return []


def segment_bands(bgr: np.ndarray) -> dict | None:
    """多元素分层：{front: mask, mid: mask|None, back: mask|None, meta: [...]}；
    无实例/模型不可用 → None（上层回退单主体）"""
    instances = _get_instances(bgr)
    if len(instances) < 1:
        return None

    # 深度排序（模型不可用 → 画面位置启发式：越靠下越近）
    dep = depth_map(bgr)
    h, w = bgr.shape[:2]
    # 同一物体碎片合并（空间+颜色+深度相似）——"四分五裂"根因修复
    instances = _merge_fragments(bgr, instances, dep)
    medians = []
    for inst in instances:
        m = inst['mask'] > 0
        if dep is not None:
            med = float(np.median(dep[m])) if m.any() else 0.0
        else:
            ys = np.nonzero(m)[0]
            med = float(ys.mean() / h) if ys.size else 0.0  # 越靠下值越大 → 越近
        medians.append(med)
    order = np.argsort(-np.array(medians))  # 近 → 远
    bands = _band_assign([medians[i] for i in order], len(order))

    # 合并同带 mask（带内并集 → 闭运算缝合 → 保留面积 ≥1% 的连通域）
    def band_mask(member_idx: list) -> np.ndarray | None:
        if not member_idx:
            return None
        union = np.zeros((h, w), np.uint8)
        for i in member_idx:
            union = cv2.bitwise_or(union, instances[i]['mask'])
        k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        union = cv2.morphologyEx(union, cv2.MORPH_CLOSE, k5)
        union = cv2.morphologyEx(union, cv2.MORPH_OPEN, k5)
        num, labels, stats, _ = cv2.connectedComponentsWithStats(union, 8)
        keep = np.zeros((h, w), np.uint8)
        for i in range(1, num):
            if int(stats[i, cv2.CC_STAT_AREA]) >= (h * w) * 0.01:
                keep = cv2.bitwise_or(keep, (labels == i).astype(np.uint8) * 255)
        return keep

    by_band = {FRONT: [], MID: [], BACK: []}
    for rank, band in zip(order, bands):
        by_band[band].append(int(rank))
    masks = {
        FRONT: band_mask(by_band[FRONT]),
        MID: band_mask(by_band[MID]) if by_band[MID] else None,
        BACK: band_mask(by_band[BACK]) if by_band[BACK] else None,
    }
    if masks[FRONT] is None or (masks[FRONT] > 0).mean() < 0.01:
        return None

    meta = []
    for rank, band in zip(order, bands):
        inst = instances[rank]
        m = inst['mask'] > 0
        ys, xs = np.nonzero(m)
        bbox = (
            {'x': float(xs.min() / w), 'y': float(ys.min() / h),
             'w': float((xs.max() - xs.min() + 1) / w), 'h': float((ys.max() - ys.min() + 1) / h)}
            if xs.size else None
        )
        meta.append({'band': band, 'score': round(float(inst['score']), 2), 'bbox': bbox})
    method = 'sam-depth' if _last_source == 'sam' else 'fastsam-depth'
    return {'front': masks[FRONT], 'mid': masks[MID], 'back': masks[BACK], 'meta': meta, 'method': method}
