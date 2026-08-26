# 立绘管线契约 · 照片 → 剪纸分层立体绘本（v3：侘寂纸感 + 多元素分层）

> 实现：`server/pipeline.py`（Python + OpenCV，FastAPI 入口 `server/app.py`）。
> 2026-08 技术路线调整：由前端 opencv.js + Web Worker 迁至 Python 后端（development.md §12 v0.4）；
> v0.5 升级：侘寂纸感风格化（stylize.py，确定性）+ 多元素前/中/后分层（multilayer.py：FastSAM 实例分割 + Depth-Anything-v2 深度排序）。
> 前端仅保留 HTTP 调用（`web/src/features/convert/api.ts`）与产物消费。
> 契约关系：转换页（convert）调用 `POST /api/convert` → 四层 PNG + `config` → 存
> `Draft.layers` / `Draft.cutoutConfig`（db.ts）→ 3D 场景（three/）消费 `config` 做分层视差与配色。
> 相关决策：development.md §2 决策 2/3/10/12、§3.1 第 3 步、§5.4。

## 1. 公开 API

```text
POST /api/convert        multipart: photo（≤25MB，JPEG/PNG/WebP/BMP/GIF）
200 → { foreground, midground, backdrop, background, base, shadow: dataURL, config: CutoutConfig }（midground/backdrop 无产物时为空串）
422 → 无法解码的照片；413 → 超出大小限制
```

- 服务器**内存态处理**：不落盘、不保存照片与产物（隐私承诺，见 development.md §5.4）。
- 前端地址默认 `http://127.0.0.1:8000`，可用 `VITE_CONVERT_API` 覆盖（部署到云端后指向站点）。
- 类型契约（TS）：`web/src/features/convert/types.ts`（CutoutConfig / CutoutResult 与本文一一对应）。

## 2. 产物（CutoutResult）

| 字段 | 格式 | 说明 |
|------|------|------|
| `foreground` | PNG (RGBA) | **最近带**元素层（alpha 抠图 + 纸缘 + Canny 淡墨线 + 纸纹颗粒 + 去饱和；FastSAM 实例 / 单主体回退同构） |
| `midground` | PNG (RGBA) | **中间带**元素层（多元素路径；空串 = 无） |
| `backdrop` | PNG (RGBA) | **最远带**元素层（多元素路径；空串 = 无） |
| `background` | PNG (RGB) | 背景虚化层：纯模糊填充（半分辨率 σ14 ≈ 全分辨率 σ28），55% 向纸色过渡 + 45% 去饱和（插画化背景，主体区不再掺原色） |
| `base` | PNG (RGB) | 纸页底层：程序化纸纹理（`--paper #F4EFE6` + 径向暗角 + 确定性噪点，种子 7） |
| `shadow` | PNG (RGBA) | 前景投影层：mask 高斯模糊（σ=8）剪影，右下偏移约 1.5%/1.2%，最大不透明度 0.45（3D 层次分离） |
| `config` | JSON | CutoutConfig（见 §3） |

各层均为工作图尺寸（≤768 长边）；元素层按 `config.layers` 的 band 顺序叠放，3D 视差幅度随带递减（front ±5% / mid ±3% / back ±1.5%）。

## 3. 配置 JSON（CutoutConfig，version: 1）

```jsonc
{
  "version": 1,
  "workSize": { "width": 768, "height": 576 },
  "subjectBBox": { "x": 0.36, "y": 0.33, "w": 0.28, "h": 0.34 }, // 归一化 0..1，相对工作图
  "mainColor": { "r": 216, "g": 74, "b": 60 },   // 主体均值色（sRGB），配色提示
  "palette": {
    "paper":   { "r": 244, "g": 239, "b": 230 }, // --paper
    "bgTint":  { "r": 201, "g": 187, "b": 163 }  // 背景层均值（含纸色过渡）
  },
  "depth": 0.62,            // 建议视差深度 0..1 = clamp(0.25 + coverage*1.3 + saliencyScore*0.35)
  "maskCoverage": 0.06,     // 主体像素占比
  "usedFallback": false,    // 显著性/GrabCut 失败 → 中心构图启发式（椭圆 55% 画幅）
  "saliency": { "method": "contrast-sr", "score": 0.74 }, // 'contrast-sr' | 'heuristic-center'
  "timingMs": { "decode": 8, "saliency": 30, "grabcut": 230, "layers": 200, "total": 500 }
}
```

## 4. 处理流水线（server/pipeline.py）

1. **解码 + EXIF 归一化**：Pillow 解码 + `ImageOps.exif_transpose`（Orientation 1..8）。
2. **降采样**：长边 ≤768（cv2 INTER_AREA；手机屏 375px 视觉无差，比 1024 少 44% 像素量）。
3. **风格化**（stylize.py v4）：AnimeGANv2 **Hayao（宫崎骏风）**整图插画化（ONNX 本地 0.5s，face_paint 兜底）→ 侘寂调色/纸混合/颗粒收敛纸感；模型缺失回退确定性链（调色 → 磨平 → 量化 → 纸混合 → 颗粒）。
4. **多元素分层**（multilayer.py）：FastSAM（640 输入）实例分割 → **逐实例精修**（闭运算合并碎块、最大连通域、GrabCut mask 先验边界精修、平滑）→ Depth-Anything-v2 深度图 → 实例按 mask 内中位深度排序 → 前/中/后三带（≤2 实例合并为前/后）；模型缺失/失败 → 回退 5. 单主体显著性路径。
4.5 **背景填充**：元素区域先 `cv2.inpaint`（Telea，r=3）抹除残留，再模糊纸化（无物体残影）。
5. **显著性起框**（回退路径，双通道，≤64 地图边长取 2 的幂）：
   - `colorContrastSaliency`：像素到全图均值色的距离（对彩色主体鲁棒、确定性好）；
   - `spectralResidualSaliency`：频谱残差（Hann 窗 + 频谱高斯平滑抑制振铃；numpy FFT）；
   - 合成：`max(cc, 0.5·sr)` → 阈值 `max(Otsu, 0.35·峰值)` → 3×3 膨胀 → 最大 8-连通域 bbox。
6. **GrabCut 抠图**（回退路径）：rect 初始化（bbox 外扩 10%）→ 2 次迭代 → 前景位提取 → 开运算去噪 →
   最大连通域 → 3×3 膨胀收边。
7. **剪纸分层**（§2）+ **配置**（§3）。

**兜底**：显著图峰值 <0.2（均匀画面）或连通域 <2% 或 GrabCut 异常/结果 <2% →
中心椭圆（55% 画幅）启发式，`usedFallback=true`；转换页可提示「效果一般」但产物始终合法。

## 5. 性能与资源

- 后端热运行（uvicorn 常驻，桌面机器实测）：**约 1.9~2.3s/张**（768 长边，多元素路径：
  FastSAM ≈0.8s + 深度 ≈0.6s + 风格化 ≈0.1s + 分层 ≈0.3s）；单主体回退 ≈0.6s。
- 模型：FastSAM_S.onnx（47MB）+ Depth-Anything-v2-small 量化（27MB），首次转换时自动下载
  （GitHub 镜像列表/HF 镜像，`HUIYI_MODELS_DIR` 可指定目录），之后常驻内存。
- 与前端 WASM 版（3.0~3.5s 含 opencv 下载/初始化）相比对低端设备零负担：无 10MB opencv.js 下载、
  无 WASM 内存限制、无浏览器差异。
- 首请求含 numpy/cv2 进程内初始化（约 1~6s），常驻后无此开销。
- 上传耗时：2~5MB 原图（局域网/宽带 <1s；弱网 5~20s，弱网场景建议后续在 capture 阶段压缩后上传）。
- 前端零 WASM：转换页仅做上传 + 产物回填（`features/convert/api.ts`，90s 超时兜底）。

## 6. HTTP 协议（server/app.py）

```text
请求：POST /api/convert   Content-Type: multipart/form-data  (photo: 文件)
响应：200
{
  "foreground": "data:image/png;base64,…",
  "background": "data:image/png;base64,…",
  "base": "data:image/png;base64,…",
  "shadow": "data:image/png;base64,…",
  "config": { …CutoutConfig }
}
错误：413 照片太大（>25MB）| 422 无法解码
```

## 7. 测试

- `server/`：冒烟验证（合成图 → 四层 PNG 可解码、config 字段合法、usedFallback 兜底路径）；
  curl 冒烟：`curl -F photo=@x.png http://127.0.0.1:8000/api/convert`。
- 前端（vitest）：`features/convert` 无单测依赖（纯 fetch）；db/flow/book/ai/memory 测试不受影响；
  e2e（headless Chrome + 后端）：上传 → 转换完成 → 四层回填 IndexedDB → 3D/静态预览渲染。
- 算法行为与旧 TS 版对齐验证：合成暖底红圆场景的 `subjectBBox` 与 TS 版逐位一致。

## 8. 开源方案验证（development.md §5.5 待验证项，2026-08 结论）

| 项目 | 结论 | 说明 |
|------|------|------|
| [tiefling](https://github.com/combatwombat/tiefling) | **不引入，仅参考** | 2D→3D 生成器，依赖 ML 深度估计（MiDaS 类）与分割模型，与「零生成式 AI、确定性算法」（决策 #2）相悖；其分层预览交互可作 UI 参考 |
| [DepthParallax](https://github.com/giulioz/DepthParallax) | **不引入，仅参考** | 需要**外部深度图**（iPhone X 人像深度）作为输入；我们没有深度图，深度由剪纸层数合成。其顶点位移视差 shader 思路与我们的分层视差一致 |
| [three-layered-material](https://github.com/aiira-co/three-layered-material) | **可借鉴，不整体引入** | 多层照片材质系统（LayeredMaterial + 视差），与我们的三层剪纸结构最接近；但面向 PSD 多层导出、非 R3F 生态，且 t4 已自研翻页材质。采纳其「层间视差位移」思路 |
| [Depthflow-WebGL](https://github.com/akatz-ai/Depthflow-WebGL) | **不引入，仅参考** | 同为深度图驱动（ML 深度模型 + 点云/视差），输入前提不满足 |
| opencv-python 显著性模块 | **不可用，自研替代** | OpenCV 的 saliency 模块（StaticSaliencySpectralResidual）在 opencv-python 中同样**不含**（需 contrib 扩展），延续自研频谱残差（numpy FFT，64×64 <10ms） |

**结论**：§5.5 候选均不整体引入（输入前提或技术路线不符）；采纳「分层视差」思路自研，
记录于本文档（符合 §5.5「裁剪或自研必须记录理由于本文档」）。

## 9. 已知取舍

- 显著性对「主体与背景色差小」或「主体占画幅 >70%」的照片效果一般 → 自动降级中心构图，
  对 GrabCut 影响有限（rect 更大）。
- 图层 PNG 未做尺寸缩放（保持工作图原尺寸），3D 场景按需降采样纹理（§6.2 纹理降采样）。
- 转换需网络（后端）；断网时书与草稿仍可读写（README 验收要点）。
- 弱网上传耗时可能超过本地处理耗时——后续可在 capture 阶段先压缩（≤2048 长边 JPEG）再上传。
- FastSAM 对高度抽象/低对比场景可能漏检实例 → 自动回退单主体路径；深度排序对摆拍多主体照片
  分带效果最佳（近大远小）。
- 多元素路径依赖两个 ONNX 模型（首次 ~75MB 下载）；离线部署需预置 models/ 目录。
