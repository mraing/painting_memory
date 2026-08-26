// 纹理加载与生命周期管理（§6.2：全部降采样至屏幕分辨率；卸载时 dispose 释放）。
// Blob 一律经 objectURL 加载并在卸载时 revoke，避免内存/句柄泄漏。

import { useEffect, useLayoutEffect, useState } from 'react';
import * as THREE from 'three';

export type TextureSource = Blob | string;

export function srcToUrl(src: TextureSource): string {
  return src instanceof Blob ? URL.createObjectURL(src) : src;
}

export function revokeSrcUrl(src: TextureSource, url: string) {
  if (src instanceof Blob) URL.revokeObjectURL(url);
}

/** 加载图片并降采样到 maxDim（默认 1024px，屏幕分辨率内）。 */
export function loadImage(url: string, maxDim = 1024): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        if (img.width <= maxDim && img.height <= maxDim) {
          resolve(img);
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        if (!ctx) {
          resolve(img);
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const out = new Image();
        out.onload = () => resolve(out);
        out.onerror = () => reject(new Error('降采样失败'));
        out.src = c.toDataURL('image/png');
      } catch {
        resolve(img);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

export function imageToTexture(img: HTMLImageElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 页面纹理按屏幕尺寸渲染，无需 mipmap（省一半显存）
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * 异步加载一个受管纹理：挂载时创建、卸载或换源时 dispose + revoke。
 * StrictMode 双执行安全：每次 effect 运行创建自己的纹理，cleanup 只释放本次的。
 */
export function useManagedTexture(
  src: TextureSource | null | undefined,
  maxDim = 1024,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useLayoutEffect(() => {
    if (src == null) {
      setTexture(null);
      return;
    }
    let alive = true;
    let tex: THREE.Texture | null = null;
    const url = srcToUrl(src);
    (async () => {
      try {
        const img = await loadImage(url, maxDim);
        if (!alive) return;
        tex = imageToTexture(img);
        if (!alive) {
          tex.dispose();
          return;
        }
        setTexture(tex);
      } catch {
        // 加载失败：保持 null，调用方走降级
      }
    })();
    return () => {
      alive = false;
      tex?.dispose();
      revokeSrcUrl(src, url);
      setTexture(null);
    };
  }, [src, maxDim]);

  return texture;
}

/** 遍历对象树释放 geometry/material/纹理（组件卸载时调用）。 */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      for (const m of material) disposeMaterial(m);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material) {
  const maps: Array<THREE.Texture | null | undefined> = [
    (material as THREE.MeshBasicMaterial).map,
    (material as THREE.MeshStandardMaterial).normalMap,
  ];
  for (const map of maps) map?.dispose();
  material.dispose();
}

/** 使用受管的三方纹理（如程序化 canvas 纹理），卸载时自动 dispose。 */
export function useOwnedTexture(create: () => THREE.Texture | null, deps: unknown[]): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const t = create();
    setTexture(t);
    return () => {
      t?.dispose();
      setTexture(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return texture;
}

/** 给静态降级版用的 Blob → objectURL（卸载时 revoke）。 */
export function useImageUrl(src: TextureSource | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (src == null) {
      setUrl(null);
      return;
    }
    const u = srcToUrl(src);
    setUrl(u);
    return () => {
      revokeSrcUrl(src, u);
      setUrl(null);
    };
  }, [src]);
  return url;
}
