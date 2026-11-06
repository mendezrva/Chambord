import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { PALETTE } from '../tiles/palette';

const N = 180;
const COLORS = [PALETTE.bavariaBlue, PALETTE.whitewash, PALETTE.bavariaBlue, 0xf2b630, 0xd9482b];

/** Blue-and-white confetti burst for a completed town. */
export function Confetti({ at }: { at: { x: number; z: number; n: number } | null }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const state = useMemo(
    () => ({ p: new Float32Array(N * 3), v: new Float32Array(N * 3), r: new Float32Array(N * 3), life: -1 }),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) m.setColorAt(i, c.setHex(COLORS[i % COLORS.length]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  useEffect(() => {
    if (!at) return;
    for (let i = 0; i < N; i++) {
      state.p.set([at.x, 0.6, at.z], i * 3);
      const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.2;
      state.v.set([Math.cos(a) * s, 4 + Math.random() * 4, Math.sin(a) * s], i * 3);
      state.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    }
    state.life = 0;
  }, [at, state]);

  useFrame((_, raw) => {
    const m = mesh.current;
    if (!m) return;
    if (state.life < 0) { m.visible = false; return; }
    const dt = Math.min(raw, 0.05);
    state.life += dt;
    m.visible = state.life < 3;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      state.v[j + 1] -= 9 * dt;
      // Air drag makes the pieces flutter down.
      state.v[j] *= 0.985; state.v[j + 2] *= 0.985;
      if (state.v[j + 1] < -1.2) state.v[j + 1] = -1.2;
      state.p[j] += state.v[j] * dt; state.p[j + 1] += state.v[j + 1] * dt; state.p[j + 2] += state.v[j + 2] * dt;
      dummy.position.set(state.p[j], Math.max(0.05, state.p[j + 1]), state.p[j + 2]);
      dummy.rotation.set(state.r[j] + state.life * 7, state.r[j + 1] + state.life * 5, state.r[j + 2]);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} visible={false} frustumCulled={false}>
      <boxGeometry args={[0.07, 0.01, 0.045]} />
      <meshStandardMaterial roughness={0.6} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}
