// 立绘交互预览（§3.1 第3步 / §4.4）：背景层 / 前景剪纸层（alpha 纹理）分层平面，
// 跟随指针轻微倾斜视差 + 缓慢呼吸浮动；纸缘厚度感用同形深色副本（放大 1.2% 露边）模拟；
// 纹理降采样 + 卸载 dispose。WebGL 不可用 / 强制降级时渲染静态 CSS 视差版。

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { useCapabilities } from './capabilities';
import { GLBoundary } from './GLBoundary';
import { useImageUrl, useManagedTexture, type TextureSource } from './textures';

export interface IllustrationLayers {
  /** 前景剪纸（最近带，alpha 纹理） */
  foreground?: TextureSource | null;
  /** 中间带元素层（无 → 不渲染） */
  midground?: TextureSource | null;
  /** 最远带元素层（无 → 不渲染） */
  backdrop?: TextureSource | null;
  /** 背景虚化层（管线已虚化，WebGL 侧不做后处理） */
  background?: TextureSource | null;
  /** 纸页底 */
  base?: TextureSource | null;
  /** 可选：剪纸投影（预生成的模糊阴影图） */
  shadow?: TextureSource | null;
}

export interface IllustrationSceneProps {
  layers: IllustrationLayers;
  /** 画面宽高比（宽/高），默认 3/4 */
  aspect?: number;
  /** 是否响应指针视差，默认 true */
  interactive?: boolean;
  /** 呼吸浮动幅度（世界单位），默认 0.012；prefers-reduced-motion 时强制 0 */
  breath?: number;
  /** 演示/测试用：强制走静态降级版 */
  forceFallback?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function IllustrationScene({
  layers,
  aspect = 3 / 4,
  interactive = true,
  breath = 0.012,
  forceFallback = false,
  className,
  style,
}: IllustrationSceneProps) {
  const caps = useCapabilities();
  if (forceFallback || caps.webgl !== 'full') {
    return <IllustrationStatic layers={layers} aspect={aspect} className={className} style={style} />;
  }
  return (
    <GLBoundary
      // Canvas 运行期崩溃（弱 GPU/驱动问题）→ 静态降级，避免整页白屏
      fallback={<IllustrationStatic layers={layers} aspect={aspect} className={className} style={style} />}
    >
      <Canvas
        className={className}
        // 调用方需经 style 给定高度（如 height: '62vh'）；Canvas 需可测高的父级
        style={{ touchAction: 'none', ...style }}
        dpr={[1, 1.75]}
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 4], fov: 36 }}
      >
        <IllustrationSceneInner
          layers={layers}
          aspect={aspect}
          // §4.3 尊重 prefers-reduced-motion：指针视差与呼吸浮动一并关闭（t10）
          interactive={caps.reducedMotion ? false : interactive}
          breath={breath}
        />
      </Canvas>
    </GLBoundary>
  );
}

function IllustrationSceneInner({
  layers,
  aspect,
  interactive,
  breath: breathProp,
}: Required<Pick<IllustrationSceneProps, 'layers' | 'aspect' | 'interactive' | 'breath'>>) {
  const caps = useCapabilities();
  const breath = caps.reducedMotion ? 0 : breathProp;

  const fgTex = useManagedTexture(layers.foreground, 1024);
  const midTex = useManagedTexture(layers.midground, 1024);
  const backTex = useManagedTexture(layers.backdrop, 1024);
  const bgTex = useManagedTexture(layers.background, 1024);
  const baseTex = useManagedTexture(layers.base, 1024);
  const shadowTex = useManagedTexture(layers.shadow, 1024);

  const { viewport } = useThree();
  // 适配视口：高度优先，宽度兜底
  const h = Math.min(viewport.height * 0.8, (viewport.width * 0.94) / aspect);
  const w = h * aspect;

  const group = useRef<THREE.Group>(null);
  const fgRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const backRef = useRef<THREE.Mesh>(null);
  const parallax = useRef({ x: 0, y: 0 });

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const targetX = interactive ? state.pointer.x : 0;
    const targetY = interactive ? state.pointer.y : 0;
    const k = Math.min(1, dt * 4);
    parallax.current.x += (targetX - parallax.current.x) * k;
    parallax.current.y += (targetY - parallax.current.y) * k;
    // 轻微倾斜视差：立体剪纸的「斜着看」感（幅度经过调参：前景 ±5%、旋转 0.12）
    g.rotation.y = parallax.current.x * 0.12;
    g.rotation.x = -parallax.current.y * 0.07;
    // 呼吸浮动
    g.position.y = Math.sin(t * 0.7) * breath;
    // 前/中/远带元素：视差幅度随深度带递减（前景 ±5%、中景 ±3%、远景 ±1.5%）
    if (fgRef.current) {
      fgRef.current.position.x = parallax.current.x * w * 0.05;
      fgRef.current.position.y = parallax.current.y * h * 0.04;
    }
    if (midRef.current) {
      midRef.current.position.x = parallax.current.x * w * 0.03;
      midRef.current.position.y = parallax.current.y * h * 0.024;
    }
    if (backRef.current) {
      backRef.current.position.x = parallax.current.x * w * 0.015;
      backRef.current.position.y = parallax.current.y * h * 0.012;
    }
  });

  const geometry = <planeGeometry args={[w, h]} />;

  return (
    <group ref={group}>
      {/* 纸页底（最大，留出血） */}
      {baseTex && (
        <mesh position={[0, 0, -0.3]} raycast={() => null}>
          <planeGeometry args={[w * 1.06, h * 1.06]} />
          <meshBasicMaterial map={baseTex} />
        </mesh>
      )}
      {/* 背景虚化层 */}
      {bgTex && (
        <mesh position={[0, 0, -0.14]} raycast={() => null}>
          <planeGeometry args={[w * 1.02, h * 1.02]} />
          <meshBasicMaterial map={bgTex} />
        </mesh>
      )}
      {/* 最远带元素（视差 ±1.5%） */}
      {backTex && (
        <mesh ref={backRef} position={[0, 0, 0.0]} raycast={() => null}>
          {geometry}
          <meshBasicMaterial map={backTex} transparent alphaTest={0.02} depthWrite={false} />
        </mesh>
      )}
      {/* 中间带元素（视差 ±3%） */}
      {midTex && (
        <mesh ref={midRef} position={[0, 0, 0.06]} raycast={() => null}>
          {geometry}
          <meshBasicMaterial map={midTex} transparent alphaTest={0.02} depthWrite={false} />
        </mesh>
      )}
      {/* 剪纸投影 */}
      {shadowTex && (
        <mesh position={[w * 0.02, -h * 0.018, 0.04]} raycast={() => null}>
          {geometry}
          <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
        </mesh>
      )}
      {/* 纸缘厚度：同形深色副本放大 1.2%，露出的暗边即「纸的厚度」 */}
      {fgTex && (
        <mesh position={[0, 0, 0.095]} scale={1.012} raycast={() => null}>
          {geometry}
          <meshBasicMaterial
            map={fgTex}
            color="#221e19"
            transparent
            opacity={0.34}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* 前景剪纸层（alpha 纹理） */}
      {fgTex && (
        <mesh ref={fgRef} position={[0, 0, 0.11]} raycast={() => null}>
          {geometry}
          <meshBasicMaterial map={fgTex} transparent alphaTest={0.02} />
        </mesh>
      )}
    </group>
  );
}

/* ---------- 静态降级版：CSS 轻量视差（§6.2 两层策略的浏览层 / §6.3 降级） ---------- */

const STATIC_LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  pointerEvents: 'none',
  willChange: 'transform',
};

export function IllustrationStatic({
  layers,
  aspect = 3 / 4,
  className,
  style,
}: Pick<IllustrationSceneProps, 'layers' | 'aspect' | 'className' | 'style'>) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const caps = useCapabilities();
  const base = useImageUrl(layers.base);
  const bg = useImageUrl(layers.background);
  const back = useImageUrl(layers.backdrop);
  const mid = useImageUrl(layers.midground);
  const fg = useImageUrl(layers.foreground);
  const shadow = useImageUrl(layers.shadow);

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (caps.reducedMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    setOffset({ x: nx, y: ny });
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: String(aspect),
        overflow: 'hidden',
        perspective: 600,
        touchAction: 'pan-y',
        ...style,
      }}
      onPointerMove={onMove}
      onPointerLeave={() => setOffset({ x: 0, y: 0 })}
    >
      {base && (
        <img
          src={base}
          alt=""
          style={{ ...STATIC_LAYER_STYLE, transform: `translate3d(${-offset.x * 4}px, ${-offset.y * 3}px, -30px) scale(1.05)` }}
        />
      )}
      {bg && (
        <img
          src={bg}
          alt=""
          style={{ ...STATIC_LAYER_STYLE, transform: `translate3d(${-offset.x * 8}px, ${-offset.y * 6}px, -10px) scale(1.03)` }}
        />
      )}
      {back && (
        <img
          src={back}
          alt=""
          style={{ ...STATIC_LAYER_STYLE, transform: `translate3d(${-offset.x * 4}px, ${-offset.y * 3}px, 0px)` }}
        />
      )}
      {mid && (
        <img
          src={mid}
          alt=""
          style={{ ...STATIC_LAYER_STYLE, transform: `translate3d(${offset.x * 7}px, ${offset.y * 5}px, 10px)` }}
        />
      )}
      {shadow && (
        <img
          src={shadow}
          alt=""
          style={{ ...STATIC_LAYER_STYLE, transform: 'translate3d(2px, 2px, 14px)' }}
        />
      )}
      {fg && (
        <img
          src={fg}
          alt="立绘预览"
          className="huiyi-breathe"
          style={{
            ...STATIC_LAYER_STYLE,
            transform: `translate3d(${offset.x * 12}px, ${offset.y * 9}px, 20px)`,
          }}
        />
      )}
    </div>
  );
}
