import { cn } from '../../../utils/todoHelpers';
import { motion } from 'framer-motion';

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  indeterminate?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Checkbox({ checked, onChange, indeterminate, className, size = 'md', label }: CheckboxProps) {
  const sizes = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  };

  const iconSizes = {
    sm: 10,
    md: 12,
    lg: 14,
  };

  return (
    <label className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        onClick={onChange}
        className={cn(
          'relative flex-shrink-0 rounded-md border-2 transition-all duration-150 focus-ring',
          sizes[size],
          checked || indeterminate
            ? 'bg-primary border-primary'
            : 'border-border bg-surface hover:border-primary/50',
        )}
      >
        {checked && !indeterminate && (
          <motion.svg
            className="absolute inset-0 m-auto text-surface"
            width={iconSizes[size]}
            height={iconSizes[size]}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.15 }}
          >
            <motion.path
              d="M5 12l5 5L19 7"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.2 }}
            />
          </motion.svg>
        )}
        {indeterminate && (
          <motion.svg
            className="absolute inset-0 m-auto text-surface"
            width={iconSizes[size]}
            height={iconSizes[size]}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
          >
            <motion.path
              d="M5 12h14"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.15 }}
            />
          </motion.svg>
        )}
      </button>
      {label && <span className="text-sm text-text">{label}</span>}
    </label>
  );
}