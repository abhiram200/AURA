import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Briefcase, ShoppingBag, Heart, BookOpen, Tag } from 'lucide-react';
import { CATEGORY_CONFIG, ALL_CATEGORIES } from '../../../utils/todoConstants';
import { cn } from '../../../utils/todoHelpers';
import type { Category } from '../../../types/todo';

const CATEGORY_ICONS: Record<Category, React.ReactNode> = {
  personal: <Briefcase className="h-3.5 w-3.5" />,
  work: <BookOpen className="h-3.5 w-3.5" />,
  shopping: <ShoppingBag className="h-3.5 w-3.5" />,
  health: <Heart className="h-3.5 w-3.5" />,
  learning: <BookOpen className="h-3.5 w-3.5" />,
  none: <Tag className="h-3.5 w-3.5" />,
};

interface CategorySelectProps {
  value: Category;
  onValueChange: (value: Category) => void;
  className?: string;
}

export function CategorySelect({ value, onValueChange, className }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const config = CATEGORY_CONFIG[value] ?? CATEGORY_CONFIG.none;

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full',
          'hover:border-text-tertiary/40 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
          'transition-all duration-150',
        )}
      >
        <span
          className="flex items-center justify-center h-6 w-6 rounded-md transition-colors"
          style={{ backgroundColor: `${config.color}20`, color: config.color }}
        >
          {CATEGORY_ICONS[value] ?? CATEGORY_ICONS.none}
        </span>
        <span className="flex-1 text-left text-text">{config.label}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-text-tertiary transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              minWidth: `${Math.max(pos.width, 200)}px`,
              zIndex: 9999,
            }}
            className="rounded-xl border border-border bg-surface-raised p-1.5 shadow-xl shadow-black/20 popover-enter"
          >
            <div className="space-y-0.5">
              {ALL_CATEGORIES.map((cat) => {
                const catConfig = CATEGORY_CONFIG[cat];
                const isSelected = cat === value;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      onValueChange(cat);
                      setOpen(false);
                    }}
                    className={cn(
                      'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm w-full',
                      'cursor-pointer outline-none transition-all duration-150',
                      'hover:bg-surface hover:text-text',
                      isSelected && 'bg-surface',
                    )}
                  >
                    <span
                      className="flex items-center justify-center h-6 w-6 rounded-md transition-all"
                      style={{
                        backgroundColor: isSelected ? `${catConfig.color}25` : `${catConfig.color}12`,
                        color: catConfig.color,
                      }}
                    >
                      {CATEGORY_ICONS[cat]}
                    </span>
                    <span
                      className="flex-1 text-left"
                      style={isSelected ? { color: catConfig.color, fontWeight: 500 } : undefined}
                    >
                      {catConfig.label}
                    </span>
                    {isSelected && (
                      <span className="text-primary" style={{ color: catConfig.color }}>
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}