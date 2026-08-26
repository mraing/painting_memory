# API 契约 · 绘忆前后端共享 DTO（草案 v0）

> 前后端只经 HTTP + 本文件约定的 DTO 通信（development.md §5.6）。
> 当前前端由 `web/src/features/ai/mockAdapter.ts` 顶替，字段与本文件一一对应；
> 后端实现时（FastAPI，§5.4）以此为准。所有端点统一带设备 token 头 `X-Device-Token`。

## POST /api/understand

接收 512px 压缩图，调 VLM，返回结构化照片解读。即用即弃，服务端不存原图。

**请求**：`multipart/form-data`，字段 `photo`（image/jpeg，长边 512）

**响应** `200`：

```jsonc
{
  "subject": "一只趴在窗台上的橘猫",   // 主体
  "background": "午后的光落在旧木窗台上", // 背景描述
  "foreground": "一小团毛茸茸的影子",    // 前景描述
  "mood": "慵懒而安稳",                // 氛围
  "elements": ["窗台", "白衬衫", "绿萝"]  // 可辨识元素，≥1 个
}
```

前端类型：`PhotoInterpretation`（`features/ai/mockAdapter.ts`）。

## POST /api/chat

引导对话：服务端统一拼上下文（画像自然语言段落 + 最近 3~5 篇日记截断，控制 token 预算）。

**请求**：

```jsonc
{
  "history": [{ "role": "ai" | "user", "text": "…" }], // 本轮对话全文（L0）
  "profile": { /* §8.2 画像 JSON，可为 null */ },
  "recentDiaries": ["最近日记截断，每篇 ≤300 字"]      // 0~5 篇
}
```

**响应** `200`：`{ "question": "画面里那只小家伙，是狗狗吧？" }`

约束：一次只问一个问题；首轮必须是基于解读的**确认式**提问（可纠正，不断言）。

## POST /api/diary

生成日记；同一次调用顺带输出候选画像更新（§8.4 零成本技巧）。

**请求**：

```jsonc
{
  "conversation": [{ "role": "ai" | "user", "text": "…" }],
  "interpretation": { /* PhotoInterpretation */ }
}
```

**响应** `200`：

```jsonc
{
  "text": "那天，午后的光落在旧木窗台上……", // 150~400 字，第二人称「你」，回望式
  "profileCandidates": [ /* 候选画像更新，结构同 §8.2 子项；可为空数组 */ ]
}
```

## POST /api/archive · GET /api/archive · DELETE /api/archive

云端档案：立绘产物（剪纸图层 PNG + 配置 + 缩略图）、解读日志、画像副本。不存原图。
DELETE 删除该设备全部云端档案。结构后续随后端任务细化。

---

## 错误约定

```jsonc
{ "error": { "code": "rate_limited" | "vlm_failed" | "bad_request", "message": "人类可读说明" } }
```

前端对 AI 调用失败可重试；连续失败提示稍后再试，草稿不丢（§3.2）。
