"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { novaSceneParams } from "./nova-scene-params";

/**
 * Dome of light — a latitude-banded point cloud read as a horizon.
 * Rings (rather than uniform scatter) are what produce the filament arcs;
 * uniform distribution reads as noise.
 */
const RING_COUNT = 190;
const POINTS_PER_EQUATOR = 900;
const RADIUS = 5.2;

/** Everything below this polar angle falls outside the framed crop. */
const THETA_MAX = Math.PI * 0.42;

function buildDome() {
  const positions: number[] = [];
  const scales: number[] = [];
  const brights: number[] = [];
  const phases: number[] = [];

  for (let r = 0; r < RING_COUNT; r++) {
    // Bias sampling toward the upper cap so the visible rim stays dense.
    const v = r / (RING_COUNT - 1);
    const theta = Math.pow(v, 0.85) * THETA_MAX;
    const ringRadius = Math.sin(theta) * RADIUS;
    const y = Math.cos(theta) * RADIUS;

    const count = Math.max(12, Math.round(POINTS_PER_EQUATOR * Math.sin(theta)));
    const offset = (r % 2) * 0.5;

    for (let i = 0; i < count; i++) {
      const a = ((i + offset) / count) * Math.PI * 2;

      // Meridian gaps: without this the shell reads as uniform noise rather
      // than a woven structure, which is what sells it as engineered.
      const weave = 0.12 + 0.88 * Math.pow(Math.abs(Math.sin(a * 26)), 1.1);
      if (Math.random() > weave) continue;

      const jitter = (Math.random() - 0.5) * 0.09;
      positions.push(
        Math.cos(a) * (ringRadius + jitter),
        y + jitter * 0.5,
        Math.sin(a) * (ringRadius + jitter),
      );

      // Rim points burn brightest; that gradient is what bloom picks up.
      const rim = Math.pow(Math.sin(theta), 0.55);
      brights.push((0.3 + rim * 1.05) * (0.55 + Math.random() * 0.85));
      scales.push(0.55 + Math.random() * 1.35);
      phases.push(Math.random() * Math.PI * 2);
    }
  }

  return {
    positions: new Float32Array(positions),
    scales: new Float32Array(scales),
    brights: new Float32Array(brights),
    phases: new Float32Array(phases),
  };
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
uniform float uAmp;
uniform float uFocus;

attribute float aScale;
attribute float aBright;
attribute float aPhase;

varying float vBright;
varying float vDepth;

void main() {
  vec3 p = position;
  float pulse =
    sin(aPhase + uTime * 0.7) * 0.6 +
    sin(aPhase * 1.83 + uTime * 0.31) * 0.4;

  p += normalize(position) * pulse * uAmp;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aScale * uPixelRatio * (1.0 / max(0.001, -mv.z));

  vBright = aBright * (0.6 + 0.4 * (pulse * 0.5 + 0.5)) * (1.0 + uFocus * 0.5);
  vDepth = -mv.z;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorCore;
uniform vec3 uColorRim;
uniform float uFadeNear;
uniform float uFadeFar;

varying float vBright;
varying float vDepth;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = dot(uv, uv);
  if (d > 0.25) discard;

  float sprite = smoothstep(0.25, 0.0, d);
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDepth);
  vec3 col = mix(uColorRim, uColorCore, clamp(vBright, 0.0, 1.0));

  gl_FragColor = vec4(col, sprite * clamp(vBright, 0.0, 1.4) * fade);
}
`;

/** Frame width in world units that the dome's proportions were tuned against. */
const REFERENCE_WIDTH = 7.6;

/** Dome centre offset, expressed at reference scale. */
const CENTER_Y = -4.85;

export function NovaScene() {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { viewport } = useThree();

  const data = useMemo(buildDome, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute("aScale", new THREE.BufferAttribute(data.scales, 1));
    g.setAttribute("aBright", new THREE.BufferAttribute(data.brights, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(data.phases, 1));
    return g;
  }, [data]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uSize: { value: 9 },
      uAmp: { value: 0.07 },
      uFocus: { value: 0 },
      uColorCore: { value: new THREE.Color("#eaf0ff") },
      uColorRim: { value: new THREE.Color("#4740e8") },
      uFadeNear: { value: 5.0 },
      uFadeFar: { value: 12.5 },
    }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const { connect, focus, drift } = novaSceneParams;

    if (matRef.current) {
      const u = matRef.current.uniforms;
      u.uTime.value = t;
      u.uPixelRatio.value = Math.min(state.gl.getPixelRatio(), 2);
      u.uFocus.value += (focus * 0.6 + connect * 0.3 - u.uFocus.value) * delta * 2;
      u.uAmp.value = 0.07 + connect * 0.06;
      // Wider viewports need larger sprites to keep apparent density constant.
      u.uSize.value = 7 + Math.min(viewport.width, 16) * 0.3;
    }

    if (groupRef.current) {
      // Narrow frames only ever see a flat sliver of a fixed-radius dome, so
      // the whole thing scales with the viewport to preserve the composition.
      const s = Math.min(1, Math.max(0.34, viewport.width / REFERENCE_WIDTH));
      groupRef.current.scale.setScalar(s);
      groupRef.current.position.y = CENTER_Y * s;
    }

    if (pointsRef.current) {
      pointsRef.current.rotation.y = t * 0.035 * (0.6 + drift);
      pointsRef.current.rotation.z = Math.sin(t * 0.08) * 0.02;
    }
  });

  return (
    <group ref={groupRef} position={[0, CENTER_Y, 0]}>
      <points ref={pointsRef} geometry={geometry}>
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={VERT}
          fragmentShader={FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
