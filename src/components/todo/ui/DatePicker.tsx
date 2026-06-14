import { useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../utils/todoHelpers';

interface DatePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDate(dateStr: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  return { year: parseInt(match[1], 10), month: parseInt(match[2], 10) - 1, day: parseInt(match[3], 10) };
}

function isToday(year: number, month: number, day: number): boolean {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
}

export function DatePicker({ value, onChange, className }: DatePickerProps) {
  const today = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }, []);

  const initialMonth = useMemo(() => {
    if (value) {
      const parsed = parseDate(value);
      if (parsed) return { year: parsed.year, month: parsed.month };
    }
    return { year: today.year, month: today.month };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [viewMonth, setViewMonth] = useState(initialMonth);

  const selected = useMemo(() => (value ? parseDate(value) : null), [value]);

  const goToPrevMonth = useCallback(() => {
    setViewMonth((prev) => {
      const month = prev.month === 0 ? 11 : prev.month - 1;
      const year = prev.month === 0 ? prev.year - 1 : prev.year;
      return { year, month };
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setViewMonth((prev) => {
      const month = prev.month === 11 ? 0 : prev.month + 1;
      const year = prev.month === 11 ? prev.year + 1 : prev.year;
      return { year, month };
    });
  }, []);

  const goToToday = useCallback(() => {
    setViewMonth({ year: today.year, month: today.month });
    onChange(formatDate(today.year, today.month, today.day));
  }, [today, onChange]);

  const handleDayClick = useCallback(
    (day: number) => {
      const dateStr = formatDate(viewMonth.year, viewMonth.month, day);
      // Toggle off if clicking the already selected date
      if (value === dateStr) {
        onChange(null);
      } else {
        onChange(dateStr);
      }
    },
    [viewMonth, value, onChange],
  );

  const daysInMonth = getDaysInMonth(viewMonth.year, viewMonth.month);
  const firstDay = getFirstDayOfMonth(viewMonth.year, viewMonth.month);

  // Previous month trailing days
  const prevMonthDays = getDaysInMonth(
    viewMonth.month === 0 ? viewMonth.year - 1 : viewMonth.year,
    viewMonth.month === 0 ? 11 : viewMonth.month - 1,
  );
  const trailingDays = Array.from({ length: firstDay }, (_, i) => prevMonthDays - firstDay + 1 + i);

  // Current month days
  const currentDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Next month leading days
  const totalCells = firstDay + daysInMonth;
  const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  const leadingDays = Array.from({ length: remainingCells }, (_, i) => i + 1);

  const monthLabel = new Date(viewMonth.year, viewMonth.month).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className={cn('p-3 select-none', className)}>
      {/* Header: month/year + navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={goToPrevMonth}
          className="p-1 rounded-md hover:bg-surface-hover text-text-secondary transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-text">{monthLabel}</span>
        <button
          type="button"
          onClick={goToNextMonth}
          className="p-1 rounded-md hover:bg-surface-hover text-text-secondary transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day of week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS_OF_WEEK.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-text-tertiary py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {/* Trailing days from previous month */}
        {trailingDays.map((day) => (
          <div
            key={`prev-${day}`}
            className="text-center text-xs py-1.5 text-text-tertiary/40"
          >
            {day}
          </div>
        ))}

        {/* Current month days */}
        {currentDays.map((day) => {
          const isSelected = selected !== null && selected.year === viewMonth.year && selected.month === viewMonth.month && selected.day === day;
          const isDayToday = isToday(viewMonth.year, viewMonth.month, day);

          return (
            <button
              key={`curr-${day}`}
              type="button"
              onClick={() => handleDayClick(day)}
              className={cn(
                'text-center text-sm py-1.5 rounded-md transition-all duration-150 relative',
                'hover:bg-surface-hover',
                isSelected && 'bg-primary text-surface hover:bg-primary-dark font-semibold',
                !isSelected && isDayToday && 'font-semibold text-primary',
              )}
            >
              {isDayToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
              )}
              {day}
            </button>
          );
        })}

        {/* Leading days from next month */}
        {leadingDays.map((day) => (
          <div
            key={`next-${day}`}
            className="text-center text-xs py-1.5 text-text-tertiary/40"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Footer: Today shortcut */}
      <div className="mt-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={goToToday}
          className="text-xs text-primary hover:text-primary-dark font-medium transition-colors"
        >
          Go to today
        </button>
      </div>
    </div>
  );
}