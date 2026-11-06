import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { PALETTE } from '../tiles/palette';
import { makeRng, range } from '../tiles/rng';
import { shardify } from '../tiles/shards';

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 });

/** A ring of faceted Alpine peaks on the horizon, faded by fog. */
export function Mountains() {
  const peaks = useMemo(() => {
    const rng = makeRng(42);
    return Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + range(rng, -0.08, 0.08);
      const r = range(rng, 46, 62);
      const h = range(rng, 9, 19);
      const w = h * range(rng, 0.55, 0.8);
      return {
        x: Math.cos(a) * r, z: Math.sin(a) * r, h, w, ry: rng() * 3,
        rock: shardify(new THREE.ConeGeometry(w, h, 9, 5), rng, 0.06, true),
        snow: shardify(new THREE.ConeGeometry(w * 0.36, h * 0.34, 9, 2), rng, 0.05, true),
      };
    });
  }, []);
  const rock = useMemo(() => mat(PALETTE.mountain), []);
  const snow = useMemo(() => mat(PALETTE.snow), []);
  return (
    <group position={[0, -3, 0]}>
      {peaks.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} rotation={[0, p.ry, 0]}>
          <mesh material={rock} geometry={p.rock} position={[0, p.h / 2, 0]} />
          <mesh material={snow} geometry={p.snow} position={[0, p.h * 0.83, 0]} />
        </group>
      ))}
    </group>
  );
}

/** Slow low-poly clouds drifting across the valley. */
export function Clouds({ extent }: { extent: number }) {
  const group = useRef<THREE.Group>(null);
  const clouds = useMemo(() => {
    const rng = makeRng(9);
    return Array.from({ length: 7 }, () => ({
      x: range(rng, -30, 30),
      z: range(rng, -30, 30),
      y: range(rng, 7, 10),
      speed: range(rng, 0.25, 0.55),
      puffs: Array.from({ length: 4 }, (_, j) => ({
        x: j * 0.9 - 1.3 + range(rng, -0.2, 0.2),
        y: range(rng, -0.2, 0.3),
        z: range(rng, -0.4, 0.4),
        r: range(rng, 0.6, 1.1),
      })),
    }));
  }, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: PALETTE.cloud, flatShading: true, roughness: 1 }), []);
  useFrame((_, dt) => {
    group.current?.children.forEach((c, i) => {
      c.position.x += clouds[i].speed * Math.min(dt, 0.05);
      if (c.position.x > extent + 30) c.position.x = -extent - 30;
    });
  });
  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]}>
          {c.puffs.map((p, j) => (
            <mesh key={j} material={material} position={[p.x, p.y, p.z]} scale={[p.r, p.r * 0.7, p.r]} castShadow>
              <icosahedronGeometry args={[1, 0]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Warm low sun plus sky light. The shadow camera follows the board size. */
export function Lights({ extent, shadows }: { extent: number; shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const size = Math.max(8, extent + 4);
  return (
    <>
      <hemisphereLight args={[0xe8f2ff, 0x5b4a36, 1.2]} />
      {/* Cool fill from the opposite side so every facet reads, like the reference renders. */}
      <directionalLight position={[-size * 0.6, size * 0.4, -size * 0.5]} intensity={0.7} color={0xb8d4ff} />
      <directionalLight
        ref={light}
        position={[size * 0.55, size * 0.9, size * 0.35]}
        intensity={2.6}
        color={0xfff0d8}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-size}
        shadow-camera-right={size}
        shadow-camera-top={size}
        shadow-camera-bottom={-size}
        shadow-camera-near={1}
        shadow-camera-far={size * 4}
      />
    </>
  );
}
