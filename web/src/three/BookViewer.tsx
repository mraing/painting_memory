// 3D 书（§3.1.7 回看 / §6.2 两层渲染的「单页 3D 场景」）：
// 亚麻布纹封面（canvas 程序化）+ 按月分章页签 + 跟手翻页（拖动跟随、松手按速度/位移判定回弹或翻完），
// 开书默认落在最新一页；frameloop="demand" 空闲零渲染；纹理随翻页窗口加载/卸载释放。
// WebGL 不可用 / 强制降级 → BookStatic（CSS 轻量浏览，§6.3）。

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as THREE from 'three';
import { useCapabilities } from './capabilities';
import { GLBoundary } from './GLBoundary';
import {
  decideFlipEnd,
  easeToward,
  isSettled,
  mapPointerToProgress,
  pageUnderPress,
  resolvePressIntent,
  windowedVelocity,
  type VelocitySample,
} from './flipLogic';
import { createFlipMaterial } from './flipMaterial';
import { makeLinenTexture } from './procedural';
import {
  imageToTexture,
  loadImage,
  revokeSrcUrl,
  srcToUrl,
  useImageUrl,
  type TextureSource,
} from './textures';

export interface BookPage3D {
  id: string;
  /** 所属月份 'YYYY-MM'（分章依据） */
  month: string;
  /** 预渲染页图（§6.2：书页浏览 = 预渲染立绘图）；null = 暂无页图，浏览层显示空白纸 */
  image: TextureSource | null;
}

export interface BookViewerProps {
  pages: BookPage3D[];
  /** 打开时落在哪一页，默认最新页（§3.1.7） */
  initialPage?: number;
  /** 页宽高比（高/宽），默认 3/4 */
  pageAspect?: number;
  cover?: { title?: string; subtitle?: string };
  onPageChange?: (index: number) => void;
  /** 点按某页（未拖动、短按）→ 打开该页（§6.2 第二层：进入完整 3D 场景） */
  onPageTap?: (index: number) => void;
  /** 长按当前页 → 删除确认（§9：仅保留删除） */
  onLongPress?: (index: number) => void;
  /** 演示/测试用：强制走静态降级版 */
  forceFallback?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** 点按 vs 拖动的移动容差（px，nativeEvent 坐标） */
const TAP_MOVE_TOL = 8;
/** 点按最大时长（ms）：超过则视为拖动翻页意图 */
const TAP_TIME_MS = 400;
/** 长按触发时长（ms） */
const LONG_PRESS_MS = 550;
/** 松手速度采样窗口大小（个 pointermove 采样，≈50ms@60Hz） */
const VELOCITY_WINDOW = 4;

export function BookViewer({
  pages,
  initialPage,
  pageAspect = 3 / 4,
  cover,
  onPageChange,
  onPageTap,
  onLongPress,
  forceFallback = false,
  className,
  style,
}: BookViewerProps) {
  const caps = useCapabilities();
  if (forceFallback || caps.webgl !== 'full') {
    return (
      <BookStatic
        pages={pages}
        initialPage={initialPage}
        onPageTap={onPageTap}
        onLongPress={onLongPress}
        className={className}
        style={style}
      />
    );
  }
  if (pages.length === 0) {
    return (
      <div
        className={className}
        style={{
          padding: '3rem 1rem',
          textAlign: 'center',
          color: 'var(--ink-soft)',
          ...style,
        }}
      >
        书还是空的——收进第一页，它才会出现在这里。
      </div>
    );
  }
  return (
    <GLBoundary
      // Canvas 运行期崩溃（弱 GPU/驱动问题）→ 静态降级，避免整页白屏
      fallback={
        <BookStatic
          pages={pages}
          initialPage={initialPage}
          onPageTap={onPageTap}
          onLongPress={onLongPress}
          className={className}
          style={style}
        />
      }
    >
      <div
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          // Canvas 需要可测高的父容器；默认宽幅比例，调用方可经 style 覆盖
          aspectRatio: '16 / 10',
          maxHeight: '70vh',
          touchAction: 'none',
          ...style,
        }}
      >
        <Canvas
          frameloop="demand"
          dpr={[1, 1.75]}
          gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
          camera={{ position: [0, 1.2, 3.4], fov: 34 }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <BookScene
            pages={pages}
            initialPage={initialPage}
            pageAspect={pageAspect}
            cover={cover}
            onPageChange={onPageChange}
            onPageTap={onPageTap}
            onLongPress={onLongPress}
          />
        </Canvas>
      </div>
    </GLBoundary>
  );
}

/* ---------------- 3D 场景 ---------------- */

interface GrabState {
  /** 按下起点（用于平均速度参考） */
  startX: number;
  startT: number;
  /** native 坐标（点按/拖动判定用，px） */
  clientX: number;
  clientY: number;
  /** 是否已超过点按容差（进入拖动） */
  moved: boolean;
  /** 长按计时器（fire 后置 null） */
  longPressTimer: number | null;
  /** 最近采样窗口（≤4 个，松手速度用窗口端点斜率，降噪声，t9） */
  samples: VelocitySample[];
}

interface FlipState {
  active: boolean;
  /** 1 = 前翻（右→左），-1 = 后翻（左→右） */
  dir: 1 | -1;
  /** 本次按压是否真的可以翻页（边界内 + 目标页纹理已加载）。
   *  死区（末页右半 / 首页左半）或纹理未就绪时仍保持 active，供点按/长按判定使用，
   *  只是不渲染翻页网格、不允许翻完（t10：修复 §3.1.7 点按单页在端点失效）。 */
  canFlip: boolean;
  progress: number;
  /** 松手后的动画目标；null = 跟手中 */
  target: number | null;
  /** 前翻时翻的是 current 页，后翻时翻的是 current-1 页 */
  from: number;
  grab: GrabState | null;
}

function BookScene({
  pages,
  initialPage,
  pageAspect,
  cover,
  onPageChange,
  onPageTap,
  onLongPress,
}: Pick<
  BookViewerProps,
  'pages' | 'pageAspect' | 'cover' | 'onPageChange' | 'onPageTap' | 'onLongPress'
> & { initialPage?: number }) {
  const { viewport, invalidate } = useThree();
  const aspect = pageAspect ?? 3 / 4;
  const pageW = Math.min(viewport.width * 0.46, (viewport.height * 0.58) / aspect);
  const pageH = pageW * aspect;

  // —— 开书落在最新页（§3.1.7）——
  const lastIndex = pages.length - 1;
  const [current, setCurrentState] = useState<number>(() =>
    initialPage != null && initialPage >= 0 && initialPage < pages.length
      ? initialPage
      : lastIndex,
  );
  useEffect(() => {
    setCurrentState((c) => Math.min(c, pages.length - 1));
  }, [pages.length]);

  const setCurrent = useCallback(
    (next: number) => {
      setCurrentState(next);
      onPageChange?.(next);
    },
    [onPageChange],
  );

  // —— 翻页状态（ref 承载，避免每帧重渲染）——
  const flip = useRef<FlipState>({
    active: false,
    dir: 1,
    canFlip: false,
    progress: 0,
    target: null,
    from: 0,
    grab: null,
  });
  /** 翻页网格挂载/卸载的状态节拍（ref 变化不触发渲染，用此计数强制渲染） */
  const [, setFlipTick] = useState(0);
  const bumpFlipTick = useCallback(() => setFlipTick((n) => n + 1), []);
  const flipMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const setFlipMaterial = useCallback((m: THREE.ShaderMaterial | null) => {
    flipMaterialRef.current = m;
  }, []);

  // —— 纹理窗口：仅加载 current-1 / current / current+1（翻页目标），滑出即释放 ——
  const texMap = useRef<Record<number, THREE.Texture | null>>({});
  const [, forceTick] = useState(0);
  const windowIndices = useMemo(() => {
    const lo = Math.max(0, current - 1);
    const hi = Math.min(pages.length - 1, current + 1);
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
  }, [current, pages.length]);
  const pageTexture = useCallback(
    (index: number): THREE.Texture | null => texMap.current[index] ?? null,
    [],
  );

  // —— 封面（亚麻布纹 + 书名字体位，§4.4）——
  const coverTexture = useOwnedLinenTexture(cover);
  // demand 帧循环下纹理就绪后需要显式 invalidate 才会重绘
  useEffect(() => {
    invalidate();
  }, [coverTexture, invalidate]);

  // —— 按月分章页签 ——
  const chapters = useMemo(() => {
    const seen: string[] = [];
    const tabs: { month: string; index: number }[] = [];
    pages.forEach((p, i) => {
      if (!seen.includes(p.month)) {
        seen.push(p.month);
        tabs.push({ month: p.month, index: i });
      }
    });
    return tabs;
  }, [pages]);

  // —— 交互：按下（判定方向 + 长按计时）→ 拖动（跟手；超容差取消长按）→ 松手
  //    （点按：未拖动 + 短按 → onPageTap，不翻页；否则按速度/位移判定回弹或翻完）——
  const startFlip = useCallback(
    (dir: 1 | -1, x: number, t: number, ne: PointerEvent) => {
      const f = flip.current;
      if (f.active) return;
      // 边界/纹理只决定「能否真的翻页」——不提前 return：
      // 端点死区（末页右半 / 首页左半）与纹理未就绪时仍记录按压，
      // 使点按打开单页、长按删除在端点也可用（t10）。
      const tex = dir === 1 ? pageTexture(current) : pageTexture(current - 1);
      const intent = resolvePressIntent({
        dir,
        current,
        pageCount: pages.length,
        texReady: tex != null,
      });
      f.active = true;
      f.dir = dir;
      f.canFlip = intent.canFlip;
      f.progress = 0;
      f.target = null;
      f.from = dir === 1 ? current : current - 1;
      // 长按计时：期间未拖动 → 取消翻页并触发 onLongPress（删除确认，§9）
      const longPressTimer = window.setTimeout(() => {
        const f2 = flip.current;
        if (!f2.active || !f2.grab) return;
        f2.active = false;
        f2.canFlip = false;
        f2.progress = 0;
        f2.target = null;
        f2.grab = null;
        bumpFlipTick();
        invalidate();
        navigator.vibrate?.(24); // 触感反馈（不支持时静默）
        onLongPress?.(intent.pageIndex);
      }, LONG_PRESS_MS);
      f.grab = {
        startX: x,
        startT: t,
        clientX: ne.clientX,
        clientY: ne.clientY,
        moved: false,
        longPressTimer,
        samples: [{ x, t }],
      };
      bumpFlipTick();
      invalidate();
    },
    [current, lastIndex, pageTexture, bumpFlipTick, invalidate, onLongPress],
  );

  const moveFlip = useCallback(
    (x: number, t: number, ne: PointerEvent) => {
      const f = flip.current;
      if (!f.active || !f.grab) return;
      const g = f.grab;
      // 移动超过点按容差 → 视为拖动：取消长按计时
      if (
        !g.moved &&
        Math.abs(ne.clientX - g.clientX) + Math.abs(ne.clientY - g.clientY) > TAP_MOVE_TOL
      ) {
        g.moved = true;
        if (g.longPressTimer != null) {
          clearTimeout(g.longPressTimer);
          g.longPressTimer = null;
        }
      }
      // 采样窗口：保留最近 VELOCITY_WINDOW 个（松手速度用窗口端点斜率，降噪声）
      g.samples.push({ x, t });
      if (g.samples.length > VELOCITY_WINDOW) g.samples.shift();
      // 死区（canFlip=false）：仍记录采样供 tap/长按判定，但不驱动翻页进度
      if (f.canFlip) {
        f.progress = mapPointerToProgress(f.dir, x, pageW);
        if (flipMaterialRef.current) {
          flipMaterialRef.current.uniforms.uProgress.value = f.progress;
        }
      }
      invalidate();
    },
    [pageW, invalidate],
  );

  const endFlip = useCallback(
    (ne?: PointerEvent) => {
      const f = flip.current;
      if (!f.active) return;
      const g = f.grab;
      if (g) {
        if (g.longPressTimer != null) {
          clearTimeout(g.longPressTimer);
          g.longPressTimer = null;
        }
        // 点按（未拖动 + 短按）：不翻页，打开被点的单页（§6.2 第二层）。
        // 独立于 canFlip——端点死区/纹理未就绪时点按同样生效（t10）
        if (!g.moved && ne && ne.timeStamp - g.startT < TAP_TIME_MS) {
          f.active = false;
          f.canFlip = false;
          f.progress = 0;
          f.target = null;
          f.grab = null;
          bumpFlipTick();
          invalidate();
          onPageTap?.(pageUnderPress(f.dir, current));
          return;
        }
      }
      // 松手速度：采样窗口端点斜率（页/秒，正 = 朝翻完方向）
      const velocity = g ? windowedVelocity(g.samples, f.dir, pageW) : 0;
      f.grab = null;
      // 死区（canFlip=false）拖动一律回弹复位：无翻页动画可做，立即结束本次按压，
      // 避免 active 卡死导致后续按压全部被吞（t10）
      if (!f.canFlip) {
        f.active = false;
        f.progress = 0;
        f.target = null;
        bumpFlipTick();
        invalidate();
        return;
      }
      f.target = decideFlipEnd(f.progress, velocity) === 'complete' ? 1 : 0;
      invalidate();
    },
    [pageW, invalidate, bumpFlipTick, onPageTap, current],
  );

  useFrame((_, dt) => {
    const f = flip.current;
    const mat = flipMaterialRef.current;
    if (!f.active || !mat) return;
    if (f.target != null) {
      f.progress = easeToward(f.progress, f.target, dt);
      mat.uniforms.uProgress.value = f.progress;
      if (isSettled(f.progress, f.target)) {
        if (f.target >= 1) {
          // 翻完：落定新一页
          const next = f.from + f.dir;
          f.active = false;
          f.canFlip = false;
          f.progress = 0;
          f.target = null;
          setCurrent(next);
          bumpFlipTick();
        } else {
          // 回弹
          f.active = false;
          f.canFlip = false;
          f.progress = 0;
          f.target = null;
          bumpFlipTick();
        }
      }
    }
    invalidate();
  });

  const leftIndex = current - 1;

  return (
    <group>
      {/* 纹理加载槽（窗口内 3 页，卸载自动 dispose） */}
      {windowIndices.map((i) => (
        <PageTextureSlot
          key={i}
          src={pages[i].image}
          onTexture={(tex) => {
            texMap.current[i] = tex;
            forceTick((n) => n + 1);
            invalidate();
          }}
        />
      ))}

      {/* 书底托板（深色，营造厚度） */}
      <mesh position={[0, -0.004, 0]} raycast={() => null}>
        <planeGeometry args={[pageW * 2, pageH]} />
        <meshBasicMaterial color="#8F7F63" />
      </mesh>

      {/* 左页（current-1；首页时左侧为封面） */}
      <mesh position={[-pageW / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[pageW, pageH]} />
        <meshBasicMaterial color="#F4EFE6" map={leftIndex >= 0 ? pageTexture(leftIndex) : coverTexture} />
      </mesh>

      {/* 右页（current） */}
      <mesh position={[pageW / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[pageW, pageH]} />
        <meshBasicMaterial color="#F4EFE6" map={pageTexture(current)} />
      </mesh>

      {/* 按月分章页签（书沿上缘竖起的月份小签） */}
      {chapters.map((tab) => (
        <MonthTab
          key={tab.month}
          month={tab.month}
          x={-pageW + ((tab.index / Math.max(pages.length - 1, 1)) * 2) * pageW}
          y={0.018}
          z={pageH / 2 + 0.012}
          w={pageW * 0.14}
          h={0.048}
        />
      ))}

      {/* 翻页中的页（跟手 + 回弹/翻完动画）；死区按压不渲染（canFlip=false） */}
      {flip.current.active && flip.current.canFlip && (
        <FlipPageMesh
          pageW={pageW}
          pageH={pageH}
          dir={flip.current.dir}
          tex={pageTexture(flip.current.from)}
          onMaterial={setFlipMaterial}
        />
      )}

      {/* 交互平面（透明，捕捉指针；宽度 3 倍，跟手范围宽松） */}
      <mesh
        position={[0, 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          startFlip(e.point.x > 0 ? 1 : -1, e.point.x, e.nativeEvent.timeStamp, e.nativeEvent);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          moveFlip(e.point.x, e.nativeEvent.timeStamp, e.nativeEvent);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          endFlip(e.nativeEvent);
        }}
        onPointerCancel={() => endFlip()}
        onPointerLeave={() => {
          if (flip.current.grab) endFlip();
        }}
      >
        <planeGeometry args={[pageW * 3, pageH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 纹理加载槽：挂载/换源加载，卸载 dispose + revoke（StrictMode 安全）。src 为 null 时保持空白纸。 */
function PageTextureSlot({
  src,
  onTexture,
}: {
  src: TextureSource | null;
  onTexture: (tex: THREE.Texture) => void;
}) {
  useLayoutEffect(() => {
    if (src == null) return;
    let alive = true;
    let tex: THREE.Texture | null = null;
    const url = srcToUrl(src);
    (async () => {
      try {
        const img = await loadImage(url, 1024);
        if (!alive) return;
        tex = imageToTexture(img);
        if (!alive) {
          tex.dispose();
          return;
        }
        onTexture(tex);
      } catch {
        // 加载失败保持缺页（渲染层显示空白纸）
      }
    })();
    return () => {
      alive = false;
      tex?.dispose();
      revokeSrcUrl(src, url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return null;
}

/** 封面亚麻纹理（受管生命周期，卸载 dispose）。 */
function useOwnedLinenTexture(cover?: { title?: string; subtitle?: string }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const t = makeLinenTexture({
      title: cover?.title ?? '时光绘本',
      subtitle: cover?.subtitle ?? '岁月 · 光影 · 你',
    });
    setTex(t);
    return () => {
      t.dispose();
      setTex(null);
    };
  }, [cover?.title, cover?.subtitle]);
  return tex;
}

/** 翻页中的页网格：前翻挂右页位（dir=1），后翻镜像挂左页位（dir=-1，同一 shader）。 */
function FlipPageMesh({
  pageW,
  pageH,
  dir,
  tex,
  onMaterial,
}: {
  pageW: number;
  pageH: number;
  dir: 1 | -1;
  tex: THREE.Texture | null;
  onMaterial: (m: THREE.ShaderMaterial | null) => void;
}) {
  // 材质随会话在 effect 内创建/释放（StrictMode 双执行安全：每次运行自建自清）
  const [material, setMaterial] = useState<THREE.ShaderMaterial | null>(null);

  // 用 layout 阶段同步设置材质，避免首帧白板闪烁
  useLayoutEffect(() => {
    const m = createFlipMaterial({ map: null, curl: 0.05 });
    m.uniforms.uPageW.value = pageW;
    m.uniforms.uProgress.value = 0;
    m.uniforms.uMap.value = tex;
    m.uniforms.uMirrorU.value = dir === 1 ? 0 : 1;
    setMaterial(m);
    onMaterial(m);
    return () => {
      onMaterial(null);
      m.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex, dir, pageW]);

  return (
    <mesh
      position={[dir === 1 ? pageW / 2 : -pageW / 2, 0.003, 0]}
      scale={dir === 1 ? [1, 1, 1] : [-1, 1, 1]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material ?? undefined}
      raycast={() => null}
    >
      <planeGeometry args={[pageW, pageH]} />
    </mesh>
  );
}

/** 月份页签：书沿上缘竖起的月份小签（canvas 纹理，卸载 dispose）。 */
function MonthTab({
  month,
  x,
  y,
  z,
  w,
  h,
}: {
  month: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#F4EFE6';
    ctx.fillRect(0, 0, 128, 48);
    ctx.strokeStyle = '#C9BBA4';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, 126, 46);
    ctx.fillStyle = '#7A7264';
    ctx.font = '22px "Noto Serif SC", "Songti SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(month.replace('-', '.'), 64, 25);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }, [month]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[x, y, z]} rotation={[-0.5, 0, 0]} raycast={() => null}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

/* ---------------- 静态降级版（§6.2 浏览层 / §6.3 降级：CSS 轻量浏览） ---------------- */

const PAGE_FRAME: CSSProperties = {
  position: 'relative',
  background: 'var(--paper, #f5f1e8)',
  borderRadius: 4,
  boxShadow: '0 2px 14px rgba(58,54,48,0.16), 0 0 0 1px rgba(58,54,48,0.06)',
  overflow: 'hidden',
};

export function BookStatic({
  pages,
  initialPage,
  onPageTap,
  onLongPress,
  className,
  style,
}: Pick<
  BookViewerProps,
  'pages' | 'initialPage' | 'onPageTap' | 'onLongPress' | 'className' | 'style'
>) {
  const last = pages.length - 1;
  const [index, setIndex] = useState(() =>
    initialPage != null && initialPage >= 0 && initialPage <= last ? initialPage : last,
  );
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const caps = useCapabilities();
  const img = useImageUrl(pages[index]?.image ?? null);
  const month = pages[index]?.month ?? '';

  // —— 长按（删除确认，§9）；点按（打开单页）由 click 处理 ——
  const longPressedRef = useRef(false);
  // ReturnType<typeof setTimeout> 自适应宿主：浏览器返回 number，@types/node 返回 Timeout
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const handlePagePointerDown = () => {
    clearLongPress();
    longPressedRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressedRef.current = true;
      navigator.vibrate?.(24);
      onLongPress?.(index);
    }, LONG_PRESS_MS);
  };

  const handlePageClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (longPressedRef.current) {
      // 长按已触发过：抬起时的 click 不再打开单页
      longPressedRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const left = e.clientX - rect.left < rect.width / 2;
    const idx = left ? index - 1 : index;
    onPageTap?.(idx >= 0 ? idx : index);
  };

  useEffect(() => {
    setIndex((i) => Math.min(i, pages.length - 1));
  }, [pages.length]);

  if (pages.length === 0) {
    return (
      <div
        className={className}
        style={{
          padding: '3rem 1rem',
          textAlign: 'center',
          color: 'var(--ink-soft)',
          ...style,
        }}
      >
        书还是空的——收进第一页，它才会出现在这里。
      </div>
    );
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (caps.reducedMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setOffset({
      x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
      y: ((e.clientY - rect.top) / rect.height - 0.5) * 2,
    });
  };

  return (
    <div className={className} style={{ maxWidth: 360, margin: '0 auto', ...style }}>
      <div
        style={{ ...PAGE_FRAME, aspectRatio: '3 / 4', touchAction: 'pan-y', perspective: 500 }}
        onPointerMove={onMove}
        onPointerLeave={() => {
          setOffset({ x: 0, y: 0 });
          clearLongPress();
        }}
        onPointerDown={handlePagePointerDown}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onClick={handlePageClick}
      >
        {img && (
          <img
            src={img}
            alt={`第 ${index + 1} 页`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `translate3d(${offset.x * 5}px, ${offset.y * 4}px, 0)`,
              willChange: 'transform',
              pointerEvents: 'none',
            }}
          />
        )}
        <span
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            fontSize: 12,
            letterSpacing: '0.12em',
            color: 'var(--ink-soft, #857e70)',
            background: 'rgba(244,239,230,0.85)',
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          {month.replace('-', '.')}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
        }}
      >
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          style={{ ...navBtn, opacity: index <= 0 ? 0.35 : 1 }}
        >
          上一页
        </button>
        <span style={{ fontSize: 13, color: 'var(--ink-soft, #857e70)', letterSpacing: '0.1em' }}>
          {index + 1} / {pages.length}
        </span>
        <button
          type="button"
          disabled={index >= last}
          onClick={() => setIndex((i) => Math.min(last, i + 1))}
          style={{ ...navBtn, opacity: index >= last ? 0.35 : 1 }}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

const navBtn: CSSProperties = {
  font: 'inherit',
  letterSpacing: '0.1em',
  color: 'var(--ink, #3a362f)',
  background: 'transparent',
  border: '1px solid rgba(58,54,48,0.35)',
  borderRadius: 999,
  padding: '6px 14px',
  cursor: 'pointer',
};
