import { useState, useRef, useEffect } from 'react';
import { Plus, Calendar, Tag, Flag, Layers } from 'lucide-react';
import { useTodoStore } from '../store/todoStore';
import { cn } from '../utils/helpers';
import { CategorySelect } from './ui/CategorySelect';
import { GroupSelect } from './ui/GroupSelect';
import { Button } from './ui/Button';
import { Tooltip } from './ui/Tooltip';
import { DatePickerInput } from './ui/DatePickerInput';
import { ALL_PRIORITIES, PRIORITY_CONFIG } from '../utils/constants';

export function TodoForm() {
  const addTodo = useTodoStore((s) => s.addTodo);
  const lastCategory = useTodoStore((s) => s.lastCategory);
  const lastPriority = useTodoStore((s) => s.lastPriority);
  const lastGroupId = useTodoStore((s) => s.lastGroupId);
  const setLastCategory = useTodoStore((s) => s.setLastCategory);
  const setLastPriority = useTodoStore((s) => s.setLastPriority);
  const setLastGroupId = useTodoStore((s) => s.setLastGroupId);
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize textarea to fit content
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    addTodo(text.trim(), lastCategory, lastPriority, dueDate || null, lastGroupId || null);
    setText('');
    setDueDate('');
    // Reset textarea height after clearing
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} className="mb-6">
      <div className="flex gap-3 items-start">
        <div className="flex-1 relative">
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-text-tertiary pointer-events-none">
              <Plus className="h-4 w-4" />
            </span>
            <textarea
              ref={inputRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="What's next on your list?"
              rows={1}
              className={cn(
                'w-full rounded-lg border border-border bg-surface px-3 py-2 pl-10 pr-3 text-sm text-text',
                'placeholder:text-text-tertiary',
                'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
                'transition-all duration-150',
                'resize-none overflow-hidden',
              )}
            />
          </div>
        </div>
        <Button type="submit" variant="primary" disabled={!text.trim()}>
          Add
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 pt-4 border-t border-border">
        <div className="flex items-center gap-2 min-w-[160px]">
          <Tag className="h-4 w-4 text-text-tertiary flex-shrink-0" />
          <CategorySelect
            value={lastCategory}
            onValueChange={(v) => setLastCategory(v)}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2 min-w-[140px]">
          <Tooltip content={`Priority: ${PRIORITY_CONFIG[lastPriority].label} · Click to change`}>
            <span className="flex items-center gap-1 text-text-tertiary cursor-help flex-shrink-0">
              <Flag className="h-4 w-4" />
              <span className="text-xs">Priority</span>
            </span>
          </Tooltip>
          <button
            type="button"
            onClick={() => {
              const currentIndex = ALL_PRIORITIES.indexOf(lastPriority);
              const nextIndex = (currentIndex + 1) % ALL_PRIORITIES.length;
              setLastPriority(ALL_PRIORITIES[nextIndex]);
            }}
            className="px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer hover:brightness-110"
            style={{
              backgroundColor: PRIORITY_CONFIG[lastPriority].bgColor,
              color: PRIORITY_CONFIG[lastPriority].color,
              border: `1px solid ${PRIORITY_CONFIG[lastPriority].color}`,
            }}
          >
            {PRIORITY_CONFIG[lastPriority].label}
          </button>
        </div>

        <div className="flex items-center gap-2 min-w-[160px]">
          <Tooltip content="Assign this task to a project group">
            <span className="flex items-center gap-1 text-text-tertiary cursor-help flex-shrink-0">
              <Layers className="h-4 w-4" />
              <span className="text-xs">Group</span>
            </span>
          </Tooltip>
          <GroupSelect
            value={lastGroupId}
            onValueChange={setLastGroupId}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2 min-w-[200px]">
          <Tooltip content="Set a deadline — tasks past this date are flagged as overdue">
            <span className="flex items-center gap-1 text-text-tertiary cursor-help flex-shrink-0">
              <Calendar className="h-4 w-4" />
              <span className="text-xs">Due</span>
            </span>
          </Tooltip>
          <DatePickerInput
            value={dueDate}
            onChange={setDueDate}
            className="flex-1"
          />
        </div>
      </div>
    </form>
  );
}