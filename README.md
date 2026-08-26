# 绘忆 · 时光绘本

移动端照片日记 PWA：侘寂风 × 剪纸立体绘本 × AI 引导日记。详见 `development.md`。

## 快速开始

### 后端 · 立绘转换服务（FastAPI，`server/`）

照片 → 剪纸立体绘本的分层转换（分割 / 风格化 / 剪纸）由 Python 后端完成，全程内存态处理、不落盘不留原图（隐私承诺，见 `development.md` §5.4）。

需要 Python 3.10+：

```bash
cd server
python3 -m venv .venv                      # 首次
.venv/bin/pip install -r requirements.txt  # 首次
./start.sh                                 # uvicorn 0.0.0.0:8000（已在运行则直接提示）
```

- 校验：`curl http://127.0.0.1:8000/api/health`。
- **模型**：首次调用自动下载 FastSAM_S.onnx（47MB）与 depth_anything_v2_small_quant.onnx（27MB，走镜像列表，可用 `HUIYI_GITHUB_MIRROR` 覆盖）；AnimeGAN 权重（`animegan_hayao.onnx` / `animegan_face_paint.onnx`）需手动放入 `server/models/`，缺失时自动降级为确定性风格化。任一模型缺失服务照常可用。
- **接口**：`POST /api/convert`（multipart 照片，≤25MB → 分层 PNG data URL + 配置 JSON）、`GET /api/health`。
- **环境变量**：`HUIYI_MODELS_DIR`（模型目录，默认 `server/models/`）、`HUIYI_SEGMENTOR`（默认 `fastsam`，可切 `sam` 质量档）。
- 前端默认连 `http://127.0.0.1:8000`，部署后可用 `VITE_CONVERT_API` 覆盖（`web/src/features/convert/api.ts`）。

### 前端 · PWA（`web/`）

```bash
cd web
pnpm install
pnpm dev      # 开发（0.0.0.0:4177）
pnpm build    # 类型检查 + 构建
pnpm test     # vitest 冒烟测试
```

AI 对话 / 日记等能力仍由前端 Mock 适配器顶替（`web/src/features/ai/mockAdapter.ts`），接口契约见 `docs/api-contract.md`。

## 字体

全部开源、npm 引入、PWA 缓存（离线可读，development.md §5.6）：

- **正文（中）**：`@fontsource/noto-serif-sc`（思源宋体 SC），`chinese-simplified-400` 单包
  woff2 约 1.5MB，`font-display: swap`。
- **书封/标题**：`lxgw-wenkai-screen-webfont`（霞鹜文楷 Screen），`lxgwwenkaiscreen.css`
  按 unicode-range 切 97 个分片，浏览器运行时只下载页面文字命中的分片（楷体标题常用字
  仅需几个分片），天然满足子集化要求。仅 weight 400（楷体风格本无需加粗）。
- 字体与 opencv.js 懒加载块均**不进 precache**（安装负担），由 Service Worker
  `CacheFirst` 懒缓存（`vite.config.ts` 的 `runtimeCaching`：`huiyi-fonts` /
  `huiyi-opencv`），首次用到才拉取，之后离线可用。
- 兜底栈在 `web/src/styles/global.css`：`--font-serif-cn` / `--font-kaiti`，字体加载失败
  时静默退化为系统衬线/楷体栈，不影响阅读。
- UI 工具字走系统栈（`--font-ui`），清晰优先。

## 设计系统

侘寂 token 集中在 `web/src/design/`（`tokens.ts` 与 `global.css` 一一对应）：
色板（paper/ink/ink-soft/earth/moss/vermilion，development.md §4.3）、弹簧缓动
`--ease-spring`、正文行高 ≥1.9、纸颗粒纹理（`paperTexture.ts` canvas 程序化生成，
数据 URL 平铺，启动时注入 `--paper-texture`）、View Transitions 页面过渡、
`prefers-reduced-motion` 自动降级为淡入淡出。基础控件见 `web/src/components/ui/`
（Button/TextField）与 `components/Seal.tsx`（朱红落款印章）。

## PWA

- `vite-plugin-pwa`（Workbox）：App Shell precache（13 条目 ≈ 2.6MB，含 JS/CSS/图标），
  `navigateFallback` 保证任意路由离线可进；可安装（manifest 中文名「绘忆 · 时光绘本」+
  程序化纸感图标，`npm run icons` 或 `node ../scripts/generate-icons.mjs` 重新生成）。
- 断网时全局横幅提示（`components/OfflineBanner.tsx`），书与草稿仍可读写，AI 对话不可用。
- 设置页 `/settings`：隐私说明、**全部导出**（jszip：原图 + 立绘图层 + 日记 JSON +
  画像/对话，`features/export/`）、**删除我所有云端档案**（本轮清除本地档案副本，
  TODO 对齐 DELETE /api/archive，见 `features/archive/`）。

## 目录

见 `development.md` §5.6。前后端 DTO 契约统一放 `docs/`。
