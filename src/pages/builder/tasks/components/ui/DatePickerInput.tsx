import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { DatePicker } from './DatePicker';

interface DatePickerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Convert "YYYY-MM-DD" → "dd Mon yyyy" for display.
 * e.g. "2025-01-15" → "15 Jan 2025"
 */
function formatDisplayDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const day = parseInt(match[3], 10);
  const month = parseInt(match[2], 10) - 1;
  const year = match[1];
  return `${day} ${MONTH_ABBR[month]} ${year}`;
}

/**
 * Try to parse user-typed input into "YYYY-MM-DD".
 * Accepts: "15 - Jan - 2025", "15-Jan-2025", "15 Jan 2025", "2025-01-15"
 */
function parseUserInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Try "dd - Mon - yyyy" or "dd Mon yyyy" or "dd-Mon-yyyy"
  const pattern = /^(\d{1,2})\s*[-/\s.]+\s*([A-Za-z]{3})\s*[-/\s.]+\s*(\d{4})$/;
  const match = pattern.exec(trimmed);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthIdx = MONTH_ABBR.findIndex(
      (m) => m.toLowerCase() === match[2].toLowerCase(),
    );
    const year = parseInt(match[3], 10);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

export function DatePickerInput({
  value,
  onChange,
  placeholder = formatDisplayDate(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
  ),
  className,
}: DatePickerInputProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Compute position synchronously before paint
  useLayoutEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  // Close on outside click
  useLayoutEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        containerRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
      setIsTyping(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setIsTyping(false);
      }
    }
    // Delay adding listeners so the opening click doesn't close it
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

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setInputValue(raw);
      setIsTyping(true);
      const parsed = parseUserInput(raw);
      if (parsed) {
        onChange(parsed);
      } else if (raw === '') {
        onChange('');
      }
    },
    [onChange],
  );

  const handleInputBlur = useCallback(() => {
    // If the user typed something invalid, revert to stored value
    if (isTyping && inputValue) {
      const parsed = parseUserInput(inputValue);
      if (!parsed) {
        // Invalid — revert display to the stored value
        setInputValue('');
        setIsTyping(false);
      } else {
        // Valid — update display to nicely formatted version
        setInputValue('');
        setIsTyping(false);
      }
    } else {
      setIsTyping(false);
    }
  }, [inputValue, isTyping]);

  const handleInputFocus = useCallback(() => {
    setOpen(true);
  }, []);

  const handlePickerChange = useCallback(
    (newValue: string | null) => {
      if (newValue) {
        onChange(newValue);
      } else {
        onChange('');
      }
      setInputValue('');
      setIsTyping(false);
    },
    [onChange],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('');
      setInputValue('');
      setIsTyping(false);
    },
    [onChange],
  );

  const displayValue = isTyping
    ? inputValue
    : value
      ? formatDisplayDate(value)
      : '';

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      {/* Input field */}
      <div className="relative">
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-lg border border-border bg-surface pl-9 pr-8 py-2 text-sm text-text',
            'placeholder:text-text-tertiary placeholder:text-xs',
            'hover:border-text-tertiary/40 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
            'transition-all duration-150',
            open && 'ring-2 ring-primary/50 border-primary',
          )}
        />
        {value && !isTyping && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Calendar popover rendered via portal */}
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              minWidth: `${Math.max(pos.width, 280)}px`,
              zIndex: 9999,
            }}
            className="tasks-app rounded-xl border border-border bg-surface-raised shadow-xl shadow-black/20 popover-enter"
          >
            <div className="px-3 pt-2 pb-1 border-b border-border">
              <span className="text-xs text-text-tertiary">
                Pick a date or type in the input
              </span>
            </div>
            <DatePicker value={value || null} onChange={handlePickerChange} />
          </div>,
          document.body,
        )}
    </div>
  );
}