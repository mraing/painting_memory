// R3F 场景组件总出口（§5.6 three/）：
// IllustrationScene —— 立绘交互预览（分层视差 + 呼吸 + 纸缘厚度）
// BookViewer      —— 3D 书（封面/月章/跟手翻页/开书落最新页）
// 能力检测与静态降级版一并导出，调用方按 §6.2 两层策略选择渲染方式。

export { IllustrationScene, IllustrationStatic } from './IllustrationScene';
export type { IllustrationLayers, IllustrationSceneProps } from './IllustrationScene';
export { BookViewer, BookStatic } from './BookViewer';
export type { BookPage3D, BookViewerProps } from './BookViewer';
export {
  detectWebGLCapability,
  detectCapabilities,
  getCapabilities,
  useCapabilities,
} from './capabilities';
export type { CapabilityInfo, WebGLCapability } from './capabilities';
export { useManagedTexture, useImageUrl, disposeObject } from './textures';
export type { TextureSource } from './textures';
export { makeLinenTexture, makePaperTexture } from './procedural';
export {
  decideFlipEnd,
  mapPointerToProgress,
  easeToward,
  isSettled,
  clamp01,
} from './flipLogic';
export type { FlipDecision } from './flipLogic';
