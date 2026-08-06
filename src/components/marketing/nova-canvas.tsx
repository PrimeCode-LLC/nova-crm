"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { NovaScene } from "./nova-scene";

type NovaCanvasProps = {
  className?: string;
  enabled?: boolean;
};

function StaticFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        background:
          "radial-gradient(ellipse 90% 65% at 50% 105%, oklch(0.52 0.19 268 / 0.5), oklch(0.3 0.14 270 / 0.18) 45%, transparent 72%)",
      }}
    />
  );
}

function NovaCanvasInner({ className }: { className?: string }) {
  const [visible, setVisible] = useState(true);
  const [dprMax, setDprMax] = useState(1.5);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setDprMax(mq.matches ? 1.25 : 1.75);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div aria-hidden className={className}>
      <Canvas
        // Park the render loop on a hidden tab rather than unmounting: tearing
        // the WebGL context down and rebuilding it flashes on tab return.
        frameloop={visible ? "always" : "never"}
        dpr={[1, dprMax]}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: "high-performance",
        }}
        camera={{ position: [0, 0, 6.2], fov: 42, near: 0.1, far: 40 }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <NovaScene />
          <EffectComposer enableNormalPass={false}>
            <Bloom
              intensity={1.9}
              luminanceThreshold={0.04}
              luminanceSmoothing={0.4}
              mipmapBlur
              radius={0.85}
            />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}

export function NovaCanvas({ className, enabled = true }: NovaCanvasProps) {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let webgl = true;
    try {
      const c = document.createElement("canvas");
      webgl = !!(
        c.getContext("webgl2") ||
        c.getContext("webgl") ||
        c.getContext("experimental-webgl")
      );
    } catch {
      webgl = false;
    }
    setOk(enabled && !reduced && webgl);

    let cancelled = false;
    const go = () => {
      if (!cancelled) setReady(true);
    };

    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(go, { timeout: 900 });
    } else {
      timeoutId = setTimeout(go, 120);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [enabled]);

  if (!ok || !ready) return <StaticFallback className={className} />;
  return <NovaCanvasInner className={className} />;
}
