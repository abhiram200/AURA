import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useTodoStore } from '../store/todoStore';
import { Tooltip } from './ui/Tooltip';
import { cn } from '../utils/helpers';

export function TodoSearch() {
  const setFilters = useTodoStore((s) => s.setFilters);
  const search = useTodoStore((s) => s.filters.search);
  const [localSearch, setLocalSearch] = useState(search);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleChange = useCallback(
    (value: string) => {
      setLocalSearch(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setFilters({ search: value });
      }, 300);
    },
    [setFilters],
  );

  const handleClear = useCallback(() => {
    setLocalSearch('');
    setFilters({ search: '' });
    inputRef.current?.focus();
  }, [setFilters]);

  // Listen for / and Cmd+K shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        inputRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative flex items-center">
      <Search className="absolute left-3.5 h-4 w-4 text-text-tertiary pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={localSearch}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder="Search todos..."
        className={cn(
          'w-full rounded-xl border border-border bg-surface-raised pl-10 pr-10 py-2.5 text-sm text-text',
          'placeholder:text-text-tertiary',
          'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary focus:bg-surface',
          'transition-all duration-200',
        )}
      />
      {localSearch && (
        <Tooltip content="Clear search" side="bottom">
          <button
            onClick={handleClear}
            className="absolute right-3 p-0.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
      {!isFocused && !localSearch && (
        <kbd className="absolute right-3 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-text-tertiary bg-surface border border-border rounded-md">
          ⌘K
        </kbd>
      )}
    </div>
  );
}