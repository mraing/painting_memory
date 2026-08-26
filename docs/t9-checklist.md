# T9 集成验收报告（reviewer2 · 2026-08-26）

> 状态：✅ 通过（含小修）· 🟡 通过但有评估结论/遗留 · ⚠️ 需真机复核
> 范围：web/ 前端 MVP 闭环验收 + 文档更新。本轮不改大结构，小问题已就地修复。

## 1. 构建 / 测试基线

- [x] ✅ `pnpm build` 全绿（tsc --noEmit 严格模式 + vite build + PWA sw 生成；opencv.js 独立懒加载 chunk，不进 precache）
- [x] ✅ `pnpm test` 全绿 **146/146**，进程正常退出（此前 opencv 测试挂起已由 t3 收尾修复）
- [x] ✅ 核心闭环数据链路有单测覆盖：flowOps「全流程数据链路」用例（上传→转换→对话→收书→书里可见）
- [x] ⚠️ 375px 真机冒烟：本会话无浏览器工具，未做运行时走查；交互设计均按移动端约束实现（viewport-fit、safe-area、touch-action），建议按 §2 清单在真机/模拟器复核一次

## 2. t10 死区修复回归（已合入）

- [x] ✅ 末页右半页点按 → onPageTap 生效：`startFlip` 不再提前 return，tap 独立于 `canFlip`（代码走查 + `resolvePressIntent` 单测：末页 dir=1 canFlip=false 但 pageIndex=N-1）
- [x] ✅ 末页右半页长按 → onLongPress 生效（同一路径，intent.pageIndex 夹取）
- [x] ✅ 首页左半页点按/长按可用（`pageUnderPress(-1, 0)` 夹取回 0，单测覆盖）
- [x] ✅ 边界翻页仍被阻止：`canFlipDirection` 守卫（末页不向前、首页不向后），死区拖动立即复位不吞后续按压
- [x] ✅ `!tex` 不吞 tap：`texReady` 只影响 `canFlip`，不影响 tap/long-press（单测覆盖）

## 3. t4 走查低优先级项（本轮处理结论）

- [x] ✅ ① 松手速度采样：已修——`windowedVelocity`（flipLogic.ts，采样窗口 ≤4 个 pointermove ≈50ms 端点斜率）替换最后一段采样，6 个新单测覆盖方向/窗口/除零；`FLIP_VELOCITY_THRESHOLD=0.45` 保留，⚠️ 真机复核手感
- [x] 🟡 ② BookViewer 容器比例：评估结论——竖屏（manifest 锁 portrait）下 16/10 或 BookPage 的 10/8 均不触发 maxHeight 钳制，比例正常；仅横屏边缘场景会失真（书在 Canvas 内按 viewport 二次适配，不影响内容）。列为遗留低优先，不动结构
- [x] ✅ ③ BookStatic 注释误指：已核对 nodeEnv.d.ts（仅 node:zlib/node:module）并修正注释（ReturnType<typeof setTimeout> 自适应两种宿主）

## 4. 性能检查项（pipeline WASM 懒加载 + 3D 场景）

- [x] ✅ opencv.js 仅转换页首个任务时动态 import（`features/pipeline/opencv.ts ensureCv`），构建产物为独立 10MB chunk；`vite.config.ts` globIgnores 排除 precache + runtimeCaching CacheFirst（首次拉取后离线可再转换）
- [x] ✅ 512px/≤1024 工作图在 Web Worker 内处理（worker.ts），主线程无长阻塞；EXIF 方向归一化在管线内完成
- [x] ✅ worker 生命周期：新增 `disposePipeline()`（在途任务守卫），转换页卸载时调用终止 Worker、回收 WASM 内存；4 个新单测（完成后终止/在途跳过/幂等/空操作）
- [x] ✅ 3D 场景内存：纹理 ≤1024 降采样、翻页窗口 current±1 加载滑出 dispose + objectURL revoke、翻页材质随会话销毁、frameloop="demand" 空闲零渲染（代码走查；真机可经 /lab/3d FPS 计复核）
- [x] ✅ 控制台干净：代码无 console.* 噪声、无已知 React key 警告；⚠️ 真机复核

## 5. 视口 / 动效

- [x] ✅ 360/375/414：全站 max-width 约束（页面壳 640/书页 480/书浏览 maxWidth 360），无固定像素宽超视口；书章节页签行 `overflow-x: auto` 为局部滚动（非页面横向滚动）；viewport-fit=cover + safe-area padding
- [x] ✅ prefers-reduced-motion：9 处 media query（全局/UI/OfflineBanner/首页/书/故事/转换页）+ 3D 侧（IllustrationScene breath 强制 0、BookStatic/IllustrationStatic 视差关闭、CSS 呼吸动画禁用）

## 6. 本轮小修（t9 内完成，均有单测）

1. `flowOps.removeDraft` 连带清理该草稿的引导对话（孤儿数据治理，1 新单测）
2. `pipeline/index.ts` 新增 `disposePipeline()`（在途守卫 + ConvertPage 卸载调用；4 新单测；含 StrictMode 竞态修复——inFlight 同步登记）
3. `BookViewer` 松手速度改采样窗口平均（6 新单测）
4. `BookStatic` 注释误指修正

## 7. 文档更新（t9 交付物）

- [x] ✅ `development.md`：变更记录新增 v0.3（完成范围、已知偏差 5 条、遗留项）；§9 MVP 范围逐项打勾/备注
- [x] ✅ `web/README.md`：新建快速启动指南（安装/开发/构建/测试、路由地图、验收要点、目录速览、已知偏差、数据与隐私）
- [x] ✅ `docs/t9-checklist.md`：本报告；`docs/book-3d.md` / `docs/pipeline.md` 与实现一致

## 8. 遗留清单（上报 captain）

| # | 项 | 级别 | 说明 |
|---|----|------|------|
| L1 | 后端未实现（AI/云端档案） | 高（范围外） | Mock 适配器顶替，DTO 已对齐 docs/api-contract.md；设置页删除档案仅清本地副本 |
| L2 | 真机走查未执行 | 中 | 375px 交互流畅度、FPS、控制台、内存曲线需真机/模拟器复核（/lab/3d 内置 FPS 计） |
| L3 | 松手速度阈值 0.45 手感 | 低 | 真机复核后可调（位移 50% 判定为主） |
| L4 | 横屏容器比例失真 | 低 | manifest 锁竖屏，影响极小；后续可改 viewport 自适应 |
| L5 | 书空表演示数据兜底 | 低 | `BOOK_MOCK_FALLBACK` 验收后可置 false |
| L6 | 对话历史在收书后删除 | 低 | 数据卫生已修（removeDraft 连带清理）；导出 zip 不再含已收书对话（日记已入书页） |
