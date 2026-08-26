# 绘忆 · 前端（web/）

移动端照片日记 PWA：侘寂风 × 剪纸立体绘本 × AI 引导日记。产品与架构详见仓库根
[`development.md`](../development.md)（本文档为快速启动指南，v0.3 验收版）。

## 快速开始

前置：Node ≥ 20，pnpm ≥ 9；立绘转换需要 Python 3.12 后端（见下；onnxruntime 尚无 3.14 wheel）。

```bash
# 1) 立绘转换后端（Python FastAPI + OpenCV + ONNX，端口 8000）
cd server
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
./start.sh            # 等价于 .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
# 首次转换自动下载模型（FastSAM_S 47MB + Depth-Anything 27MB，GitHub/HF 镜像，存 server/models/）；
# 也可预置 models/ 目录离线部署；HUIYI_MODELS_DIR / HUIYI_GITHUB_MIRROR 可覆盖

# 2) 前端
cd ../web
pnpm install        # 安装依赖
pnpm dev            # 开发服务器，监听 0.0.0.0:4177（局域网可访问）
pnpm build          # tsc --noEmit 严格检查 + vite 构建 + PWA sw 生成
pnpm test           # vitest 全量单测
pnpm preview        # 本地预览构建产物（0.0.0.0:4173）
```

后端地址可用环境变量覆盖：`VITE_CONVERT_API=http://192.168.x.x:8000 pnpm dev`（真机联调时）。

AI（理解/对话/日记/画像提取）暂由前端 Mock 适配器顶替（`web/src/features/ai/mockAdapter.ts`），
接口契约见 `docs/api-contract.md`。

### 局域网访问（手机真机调试）

```bash
pnpm dev            # 已配置 server.host = '0.0.0.0'，自动打印 Network 地址
```

同一 Wi-Fi 下，手机浏览器打开 **`http://<电脑局域网IP>:4177`** 即可（如
`http://192.168.5.27:4177`）。注意：

- 仅 UI/功能调试可用此方式；**PWA 安装、离线、Service Worker 需要 HTTPS**（浏览器安全
  策略，仅 `localhost` 豁免）——局域网真机完整验证时可用 `mkcert` 自签证书或内网穿透，
  后续接入。
- `pnpm dev` 默认端口 4177（vite.config.ts 可改）；被占用时 Vite 会自动换端口并打印。

> 注意：开发/预览服务器请避开 127.0.0.1:3080（团队联调端口）。

## 路由地图

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 首页 | hero 文案跃动 + 拍照/相册入口 |
| `/capture` | 拍照/选图 | `<input type="file" capture>`，纯本地存草稿 |
| `/convert?draft=` | 立绘转换 | opencv.js Worker 管线（懒加载），完成后 3D 立绘预览 |
| `/story?draft=` | AI 引导对话 | 一次一问、可收束、断网禁用、可续聊 |
| `/entry?draft=` | 日记生成 + 收进书 | 150~400 字第二人称回望式；收书后跳书页 |
| `/book` | 书浏览 | 3D 书：月章/跟手翻页/点按单页/长按删除 |
| `/settings` | 设置 · 隐私 | 隐私说明、导出 zip、删除云端档案副本 |
| `/lab/3d` | 3D 实验室 | 立绘预览与 3D 书演示（mock 数据 + FPS 计 + 降级开关） |

## 验收要点（375px 移动视口）

- 核心闭环：拍照 → 转换（后端 warm <1s）→ 对话 → 日记 → 收进书 → 开书落最新页 → 长按删除 → 设置页导出 zip
- 离线：断网时对话与立绘转换不可用（需要后端），书与草稿仍可读写；PWA 安装后离线可翻书
- 性能：3D 书 `frameloop="demand"` 空闲零渲染；纹理 ≤1024px、滑出窗口即释放；前端零 WASM（opencv 已移入 server/，10MB 下载负担下线）
- 降级：WebGL 不可用 / `prefers-reduced-motion` 时自动切换静态版（`/lab/3d` 可强制演示）

## 目录速览

```
src/
├── pages/          # 路由壳（home/capture/convert/story/entry/book/settings/lab）
├── features/       # 领域切片：pipeline（opencv Worker）/ ai（Mock 适配器）/
│                   #   memory（画像）/ book（书数据）/ archive / export / flow
├── three/          # R3F 场景：IllustrationScene（立绘预览）、BookViewer（3D 书）、
│                   #   翻页 shader、能力检测与静态降级
├── db/             # Dexie schema（drafts/conversations/pages/profile/settings）
├── design/         # 设计 token、纸颗粒纹理
└── components/     # PageShell / Toast / OfflineBanner / Seal / ui
```

## 已知偏差（v0.4）

- AI（理解/对话/日记/画像提取）由 `features/ai/mockAdapter.ts` 顶替，接口契约见
  [`docs/api-contract.md`](../docs/api-contract.md)；AI 后端未实现。
- 书空表时显示演示数据（`features/book/data.ts` 的 `BOOK_MOCK_FALLBACK`，验收后可置 `false`）。
- 3D 翻页选型与松手判定参数见 [`docs/book-3d.md`](../docs/book-3d.md)。
- 立绘转换已迁至 Python 后端（`server/`），转换需网络；后端鉴权/限流（密钥网关）待部署时接入。

## 数据与隐私

- 原图/立绘/日记全部存本机 IndexedDB；立绘转换时照片会发送到转换服务器（`server/`），
  服务器内存态处理、处理完即弃、不保存原图；AI 调用仅发 512px 压缩图（当前 Mock 不真正发送）。
- 换机/清缓存前先在设置页「全部导出」zip（原图 + 立绘 + 日记 JSON + 对话 + 画像）。
