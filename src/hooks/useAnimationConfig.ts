import { useTheme } from './useTheme';
import type { AnimationIntensity } from './useTheme';

interface AnimationConfig {
  /** Current intensity level */
  animationIntensity: AnimationIntensity;
  /** Duration multiplier: subtle=0, normal=1, intense=1.5 */
  durationScale: number;
  /** Whether to play framer-motion transitions */
  enabled: boolean;
  /** Particle count multiplier */
  particleMultiplier: number;
  /** Whether to show CSS animations */
  cssAnimations: boolean;
}

const INTENSITY_CONFIGS: Record<AnimationIntensity, AnimationConfig> = {
  subtle: { animationIntensity: 'subtle', durationScale: 0, enabled: false, particleMultiplier: 0, cssAnimations: false },
  normal: { animationIntensity: 'normal', durationScale: 1, enabled: true, particleMultiplier: 1, cssAnimations: true },
  intense: { animationIntensity: 'intense', durationScale: 1.5, enabled: true, particleMultiplier: 2, cssAnimations: true },
};

export function useAnimationConfig(): AnimationConfig {
  const { animationIntensity } = useTheme();
  return INTENSITY_CONFIGS[animationIntensity];
}

/**
 * Returns framer-motion transition props scaled by animation intensity.
 * - subtle: instant (no animation)
 * - normal: standard durations
 * - intense: longer, more dramatic durations
 */
export function getTransition(base: number | { duration?: number; stiffness?: number; damping?: number; type?: string }, intensity: AnimationIntensity) {
  const scale = INTENSITY_CONFIGS[intensity].durationScale;
  if (scale === 0) return { duration: 0 };

  if (typeof base === 'number') {
    return { duration: base * scale };
  }

  if (base.type === 'spring') {
    return {
      type: 'spring' as const,
      stiffness: (base.stiffness ?? 300) / scale,
      damping: base.damping ?? 30,
    };
  }

  return {
    ...base,
    duration: (base.duration ?? 0.3) * scale,
  };
}