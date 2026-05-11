import { motion } from 'framer-motion';
import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useAnimationConfig } from '../../hooks/useAnimationConfig';

interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function GlowButton({ children, variant = 'primary', className, ...props }: GlowButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const { animationIntensity } = useAnimationConfig();
  const isSubtle = animationIntensity === 'subtle';

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect && !isSubtle) {
      setRipple({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        id: Date.now(),
      });
      setTimeout(() => setRipple(null), 600);
    }
    props.onClick?.(e);
  };

  const variantClass = `glow-btn--${variant}`;

  return (
    <motion.button
      ref={btnRef}
      className={`glow-btn ${variantClass} ${className ?? ''}`}
      whileHover={isSubtle ? undefined : { scale: 1.02 }}
      whileTap={isSubtle ? undefined : { scale: 0.97 }}
      onClick={handleClick}
      {...(props as any)}
    >
      {ripple && (
        <span
          key={ripple.id}
          className="glow-btn__ripple"
          style={{ left: ripple.x, top: ripple.y }}
        />
      )}
      {children}
    </motion.button>
  );
}