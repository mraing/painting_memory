// 入口：挂载 React 根，接入字体与纸纹理，注册 PWA
import React from 'react';
import ReactDOM from 'react-dom/client';
// 正文：思源宋体（1.5MB 中文子集，PWA 缓存）
import '@fontsource/noto-serif-sc/chinese-simplified-400.css';
// 书封/标题：霞鹜文楷 Screen（97 个 unicode-range 分包，浏览器只拉用到的字）
import 'lxgw-wenkai-screen-webfont/lxgwwenkaiscreen.css';
import './styles/global.css';
import { applyPaperTexture } from './design';
import { AppProviders } from './providers';

// 纸颗粒纹理：canvas 程序化生成 → 注入 --paper-texture（body 平铺）
applyPaperTexture();

// PWA 版本更新自愈：每次重新构建后，旧 Service Worker 可能仍服务旧 index.html，
// 其引用的旧哈希 chunk 已不存在（SPA fallback 返回 HTML → 模块 MIME 拒绝 → 转换/渲染失败）。
// 新 SW 接管（controllerchange）后自动刷新一次，换到新版本；首访（无旧 SW）不刷。
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.visibilityState !== 'visible') return;
    // 延迟片刻，避免打断页面初始绘制
    setTimeout(() => location.reload(), 2500);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders />
  </React.StrictMode>,
);
