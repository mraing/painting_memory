// 立绘转换 API（Python 后端）：POST /api/convert（multipart 照片）
// → 四层 PNG（data URL）+ 配置 JSON；后端内存态处理，不留原图（server/app.py）。
// 技术路线：2026-08 由「本地 opencv.js + Web Worker」调整为「后端 OpenCV 管线」
// （低端设备友好、速度稳定，见 development.md §12 变更记录 / docs/pipeline.md）。
import type { CutoutConfig, CutoutResult } from './types';

/** 后端地址：默认本地 uvicorn；部署后可经 VITE_CONVERT_API 覆盖（如 https://api.example.com） */
const API_BASE: string =
  (import.meta.env as Record<string, string | undefined>).VITE_CONVERT_API ??
  'http://127.0.0.1:8000';

const CONVERT_TIMEOUT_MS = 90_000;

/** 上传照片 → 四层剪纸 PNG + 配置（失败抛错：上层保留草稿、提示重试） */
export async function convertPhoto(photo: Blob): Promise<CutoutResult> {
  const fd = new FormData();
  fd.append('photo', photo, 'photo.jpg');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONVERT_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/api/convert`, {
      method: 'POST',
      body: fd,
      signal: controller.signal,
    });
  } catch {
    throw new Error(
      timedOut
        ? '转换超时（90 秒）。照片还好好存着，点「再试一次」重新转换。'
        : '转换服务连不上——请确认后端已启动（server/），并检查网络后重试。',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    let detail = '';
    try {
      const body = (await resp.json()) as { detail?: unknown };
      detail = typeof body.detail === 'string' ? body.detail : '';
    } catch {
      /* 非 JSON 错误体忽略 */
    }
    throw new Error(`转换服务错误（${resp.status}）${detail ? `：${detail}` : ''}`);
  }

  const data = (await resp.json()) as {
    foreground: string;
    midground?: string;
    backdrop?: string;
    background: string;
    base: string;
    shadow: string;
    config: CutoutConfig;
  };
  return {
    foreground: dataUrlToBlob(data.foreground),
    midground: data.midground ? dataUrlToBlob(data.midground) : null,
    backdrop: data.backdrop ? dataUrlToBlob(data.backdrop) : null,
    background: dataUrlToBlob(data.background),
    base: dataUrlToBlob(data.base),
    shadow: dataUrlToBlob(data.shadow),
    config: data.config,
  };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
