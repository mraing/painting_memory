// 立绘管线类型（2026-08 技术路线调整：本地 Worker → Python 后端，形状契约不变，
// 见 docs/pipeline.md；db/BookPage/3D 场景消费形状一致）
// 流程：EXIF 方向归一化 → 降采样 ≤768 → 显著性起框 → GrabCut → 剪纸分层（后端 OpenCV 完成）

/** 归一化矩形（0..1，相对工作图） */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** 立绘配置 JSON（存 Draft.cutoutConfig / BookPage.config，供 3D 场景消费） */
export interface CutoutConfig {
  version: 1;
  /** 工作图尺寸（图层 PNG 的实际像素尺寸） */
  workSize: { width: number; height: number };
  /** 主体 bbox（归一化 0..1，相对工作图）——最近带（front）主体 */
  subjectBBox: NormalizedRect | null;
  /** 主体主色（均值，sRGB），用于配色提示 */
  mainColor: RgbColor;
  /** 纸色与背景基调色（图层合成用色，供 3D 场景做环境呼应） */
  palette: { paper: RgbColor; bgTint: RgbColor };
  /** 建议分层深度 0..1（视差强度；由主体占比与显著性强度确定） */
  depth: number;
  /** 主体像素占比 0..1 */
  maskCoverage: number;
  /** 显著性/GrabCut 失败是否降级为中心构图启发式 */
  usedFallback: boolean;
  saliency: {
    method: 'contrast-sr' | 'heuristic-center' | 'fastsam-depth';
    /** 显著性强度 0..1（bbox 内均值） */
    score: number;
  };
  /** 多元素分层元信息（front/mid/back；单主体回退时仅 front） */
  layers?: Array<{
    band: 'front' | 'mid' | 'back';
    /** 实例置信度 0..1 */
    score: number;
    bbox: NormalizedRect | null;
  }>;
  /** 风格化元信息（侘寂纸感） */
  style?: { method: 'wabi-paper'; flatten: boolean; posterize?: boolean; grain: number };
  timingMs: {
    decode: number;
    stylize?: number;
    seg?: number;
    saliency?: number;
    grabcut?: number;
    layers: number;
    total: number;
  };
}

/** 管线产物：多层剪纸 PNG + 配置 */
export interface CutoutResult {
  /** 前景主体层（最近带，RGBA，alpha 抠图，纸缘+淡墨线风格化） */
  foreground: Blob;
  /** 中间带元素层（无 → null） */
  midground: Blob | null;
  /** 最远带元素层（无 → null） */
  backdrop: Blob | null;
  /** 背景虚化层（RGB，大模糊填充并向纸色过渡、去饱和） */
  background: Blob;
  /** 纸页底层（RGB，程序化纸纹理） */
  base: Blob;
  /** 前景投影层（RGBA，模糊剪影，右下偏移；3D 场景层次分离） */
  shadow: Blob;
  config: CutoutConfig;
}
