import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../../utils/todoHelpers';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ startIcon, endIcon, error, className, ...props }, ref) => {
    return (
      <div className="relative">
        {startIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
            {startIcon}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text',
            'placeholder:text-text-tertiary',
            'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
            'transition-all duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            startIcon && 'pl-10',
            endIcon && 'pr-10',
            error && 'border-danger focus:ring-danger/50 focus:border-danger',
            className,
          )}
          {...props}
        />
        {endIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary">
            {endIcon}
          </span>
        )}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';