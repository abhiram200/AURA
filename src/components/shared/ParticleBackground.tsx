import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAnimationConfig } from '../../hooks/useAnimationConfig';

function AmbientParticles() {
  const meshRef = useRef<THREE.Points>(null);
  const { particleMultiplier, durationScale } = useAnimationConfig();
  const count = Math.round(200 * particleMultiplier);

  const { positions, sizes } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 15 - 5;
      sizes[i] = Math.random() * 2 + 0.5;
    }
    return { positions, sizes };
  }, [count]);

  const rotSpeed = 0.02 * durationScale;

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * rotSpeed;
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * rotSpeed * 0.5) * 0.1;
    }
  });

  if (count === 0) return null;

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
          count={count}
          array={sizes}
          itemSize={1}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color="#00f0ff"
        transparent
        opacity={0.3}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

export function ParticleBackground() {
  const { enabled } = useAnimationConfig();

  if (!enabled) return null;

  return (
    <div className="particle-background">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ alpha: true, antialias: false }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <AmbientParticles />
      </Canvas>
    </div>
  );
}