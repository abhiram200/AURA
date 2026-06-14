import { forwardRef } from 'react';
import { cn } from '../../../utils/todoHelpers';
import type { ReactNode } from 'react';

interface BadgeProps {
  label: string;
  color?: string;
  bgColor?: string;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  className?: string;
  onClick?: () => void;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { label, color, bgColor, size = 'sm', icon, className, onClick },
  ref,
) {
  const sizes = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-0.5 text-xs',
  };

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        sizes[size],
        className,
      )}
      style={{
        color: color || 'var(--color-text-secondary)',
        backgroundColor: bgColor || 'var(--color-surface-raised)',
      }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {label}
    </span>
  );
});