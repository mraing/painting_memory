// 侘寂设计 token —— development.md §4.3
// 与 styles/global.css 的 CSS 变量一一对应；此文件供 TS 侧（组件逻辑、three 场景等）引用。

export const tokens = {
  /** 纸感底色（米白） */
  paper: '#F4EFE6',
  /** 主墨色：正文、标题 */
  ink: '#3A362F',
  /** 半墨：次要文字、时间戳 */
  inkSoft: '#857E70',
  /** 陶土：插图、分隔、选中态 */
  earth: '#B49A7C',
  /** 苔色（可选辅助土色）：状态、成功 */
  moss: '#77806B',
  /** 朱红：落款、关键强调（如收进书的一瞬）、hero 点睛 */
  vermilion: '#B83A1E',

  /** 正文衬线：思源宋体 */
  fontSerifCn: "'Noto Serif SC', 'Songti SC', 'SimSun', serif",
  /** 书封/标题手写体：霞鹜文楷 */
  fontKaiti: "'LXGW WenKai Screen', 'Kaiti SC', 'STKaiti', 'KaiTi', serif",
  /** UI 工具字：系统栈（清晰优先） */
  fontUi:
    "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif",

  /** 全局弹簧缓动（iOS 手感） */
  easeSpring: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** 次要缓动：进入/回弹后的收敛 */
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** 标准弹簧时长 */
  durSpring: 420,
  /** 快速反馈时长 */
  durFast: 200,

  /** 正文行高（§4.3：1.9 起步） */
  leadingBody: 1.9,
  radiusSm: 6,
  radiusMd: 10,

  /** 纸颗粒纹理平铺尺寸（与 paperTexture.ts 生成尺寸一致） */
  paperGrainSize: 256,
} as const;

export type DesignTokens = typeof tokens;
