# 3D 翻页选型记录 · book-3d.md

> 对应 development.md §5.5「3D 翻页组件（three.js 版翻书库，如 PageFlip 系）——选定后替换手写方案」。
> 结论：**3D 场景自研 shader 翻页（R3F），不引入翻书库**；轻量浏览层（§6.2）按需可引 StPageFlip。
> 记录人：reviewer2 · 2026-08-26

## 1. 约束（为什么不能随便选）

- 移动端 PWA（375px 视口为验收基准），目标 60fps，电池敏感 → 空闲必须零渲染（`frameloop="demand"`）。
- 已有技术栈 three.js 0.171 + R3F 8 + React 18（t1 骨架已定），新增依赖要过体积/维护性账。
- §6.2 两层渲染：书浏览态 = 预渲染页图 + 轻量视差；点进单页才挂完整 3D 场景 → 3D 翻页只在单页场景出现，单次只翻一页。
- 书的信息架构（§2 决策 8）：单本总书、按月分章、开书落最新页、翻页跟手（§4.3：跟随手指位移，松手按速度/位移判定回弹或翻完）。
- §5.5 工程原则：开源优先，但**裁剪/自研必须记录理由**——本文件即记录。

## 2. 候选方案对比

### A. StPageFlip（npm `page-flip`，GitHub koep-soptim/StPageFlip）

- 形态：Canvas 2D 渲染的拟 3D 翻页（折痕扫掠 + 渐变光影模拟），非 WebGL。
- 优点：移动端触摸支持成熟（drag/velocity 判定现成）；不依赖 WebGL，低端机也能用；体积约 ~50KB（未压缩）。
- 缺点：不是真 3D 场景——立绘页的「纸厚度、翻起角度」是 2D 贴图模拟；与 R3F 书（封面/月章/3D 视差）不在同一个场景里，无法和单页 3D 立体绘本衔接；需要自己包 React 壳（官方无 React 封装）；Canvas 2D 在高 DPR 下要额外做缩放处理。
- 结论：**可作为 §6.2「轻量浏览层」的候选**（书浏览态不挂 WebGL 时），但不满足「点进单页加载完整 3D 场景」的体验目标。

### B. CSS 3D / transform 翻页（turn.js 系、纯 CSS 方案）

- 形态：`perspective + rotateY` 翻片，零依赖、极轻。
- 优点：实现成本最低，静态降级版（BookStatic）已在用同思路的轻量浏览。
- 缺点：无页弯曲（平面硬翻）、无纸厚度；大图下 transform 合成层吃内存；跟手/速度判定全要自己写，且达不到「立体绘本」的质感。
- 结论：仅适合 §6.3 降级路线（WebGL 不可用 / prefers-reduced-motion）。

### C. 自研 R3F shader 翻页（选定）

- 形态：单张页网格（2 三角面片 × 细分）+ 顶点 shader：**绕书脊刚性旋转（α = progress·π，上翻过顶）+ 静态纸卷曲（curl，翻完时渐隐摊平）**；双面渲染，背面按 `gl_FrontFacing` 镜像 UV（透纸读字不反）。
- 成本：
  - 代码 ~120 行 GLSL + ~150 行控制器（跟手映射 / 松手判定 / 回弹动画），已在 `web/src/three/`，单元测试覆盖判定逻辑（`flipLogic.test.ts`）。
  - 运行时：单次只翻一页、单网格；`frameloop="demand"` 空闲零渲染；纹理 ≤1024px 且滑出窗口即 dispose。
  - 与 R3F 书同场景，封面（canvas 亚麻布纹 + 书名字体位，§4.4）、月章页签、开书落最新页全部在一个场景里做，无需跨技术栈缝合。
- 放弃的变体（记录成本，避免后人重复试错）：
  1. **行进折痕（traveling crease）完整 curl**：折痕从页尖扫向书脊、两侧分段旋转——数学上是不可展曲面（刚性旋转段与钉死桌面段在 C¹ 上不可连续，需滑动/悬空补偿），ShaderToy 系实现靠「积分型 curl profile」近似，会让未翻部分悬空抬高，中段观感反而不如刚性旋转 + 静态卷曲；且逐帧计算量更大。→ 不采用。
  2. 圆柱滚卷模型（page 绕书脊滚成筒）：翻完是「卷筒」而非平铺左页，与真实翻页不符。→ 不采用。
  3. 逐帧重建几何（CPU 算折痕）：移动端每帧 buffer 重建成本高，且收益被 shader 方案覆盖。→ 不采用。

## 3. 结论与落地

| 层 | 方案 | 位置 |
|----|------|------|
| 单页 3D 场景（点击进入） | 自研 shader 翻页（R3F） | `web/src/three/BookViewer.tsx` + `flipMaterial.ts` |
| 书浏览态（轻量） | 预渲染页图 + CSS 轻量视差；后续书浏览页任务如需真翻页观感，再引 StPageFlip 包壳 | `BookStatic` 降级版现可用 |
| 降级（无 WebGL / reduced-motion） | `useCapabilities()` 判定 → `BookStatic` / `IllustrationStatic` | `web/src/three/capabilities.ts` |

验收口径：`pnpm build` 通过；翻页逻辑单测全绿；375px 视口交互流畅（演示页 /lab/3d 带 FPS 计）；纹理随窗口/卸载 dispose（`PageTextureSlot` 清理路径）。

## 4. 性能预算备忘

- 单页网格：2×64 细分 ≈ 128 顶点，顶点 shader 纯数学运算，移动 GPU 无压力。
- 纹理：页图 ≤1024px（`loadImage` 降采样），`LinearFilter` + 无 mipmap（省显存），翻页窗口 3 页常驻。
- 渲染：`frameloop="demand"`，拖动/动画期才 `invalidate()`；`dpr` 钳制 [1, 1.75]；`antialias: false`。
- 内存：翻页材质随会话创建/销毁（`FlipPageMesh` unmount → `material.dispose()`）；页纹理滑出窗口 → `dispose()` + objectURL `revoke`。
