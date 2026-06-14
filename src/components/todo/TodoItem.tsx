import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { GripVertical, Trash2, Calendar, Pencil } from 'lucide-react';
import { useTodoStore } from '../../store/todoStore';
import { Checkbox } from './ui/Checkbox';
import { CategoryBadge } from './CategoryBadge';
import { PriorityBadge } from './PriorityBadge';
import { GroupBadge } from './GroupBadge';
import { Tooltip } from './ui/Tooltip';
import { cn, formatDueDate, isOverdue, isDueToday } from '../../utils/todoHelpers';
import type { Todo } from '../../types/todo';

interface TodoItemProps {
  todo: Todo;
  showCheckbox?: boolean;
  isGroupingTarget?: boolean;
  hideGroupBadge?: boolean;
  /** True for the floating drag overlay item — renders with elevation, no drag handle */
  isDragOverlayItem?: boolean;
  /** Show an insertion indicator line above this task */
  insertAbove?: boolean;
  /** Show an insertion indicator line below this task */
  insertBelow?: boolean;
}

export const TodoItem = forwardRef<HTMLDivElement, TodoItemProps>(function TodoItem(
  { todo, showCheckbox = false, isGroupingTarget = false, hideGroupBadge = false, isDragOverlayItem = false, insertAbove = false, insertBelow = false },
  ref,
) {
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);
  const toggleSelect = useTodoStore((s) => s.toggleSelect);
  const selectedIds = useTodoStore((s) => s.selectedIds);
  const editingId = useTodoStore((s) => s.editingId);
  const setEditingId = useTodoStore((s) => s.setEditingId);

  const [editText, setEditText] = useState(todo.text);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const checkOverflow = useCallback(() => {
    if (textRef.current) {
      setIsOverflowing(textRef.current.scrollHeight > textRef.current.clientHeight + 1);
    }
  }, []);

  // Check overflow when text changes or component mounts
  useEffect(() => {
    checkOverflow();
  }, [todo.text, checkOverflow]);

  // Re-check after expanded changes (layout shift may change clientHeight)
  useEffect(() => {
    // Use requestAnimationFrame to wait for layout to settle after class change
    const raf = requestAnimationFrame(checkOverflow);
    return () => cancelAnimationFrame(raf);
  }, [expanded, checkOverflow]);

  const isEditing = editingId === todo.id;
  const isSelected = selectedIds.includes(todo.id);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id, disabled: isDragOverlayItem });

  const style = isDragOverlayItem
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
      // Resize textarea to fit content
      if (editInputRef.current) {
        editInputRef.current.style.height = 'auto';
        editInputRef.current.style.height = editInputRef.current.scrollHeight + 'px';
      }
    }
  }, [isEditing]);

  const handleEditTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
    // Auto-resize textarea on content change
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      setEditText(todo.text);
      setEditingId(null);
    }
  };

  const handleEditSubmit = () => {
    if (editText.trim()) {
      updateTodo(todo.id, { text: editText.trim() });
    }
    setEditingId(null);
  };



  return (
    <motion.div
      ref={(node: HTMLDivElement | null) => {
        if (!isDragOverlayItem) {
          setNodeRef(node);
        }
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      style={style}
      layout={!isDragOverlayItem}
      initial={isDragOverlayItem ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.2 }}
      data-todo-id={isDragOverlayItem ? undefined : todo.id}
      className={cn(
        'relative group flex items-start gap-3 rounded-xl border bg-surface px-4 py-3',
        'hover:border-primary/30 hover:shadow-sm transition-all',
        isDragOverlayItem && 'shadow-2xl ring-2 ring-primary/30 scale-[1.02] cursor-grabbing',
        isDragging && !isDragOverlayItem && 'opacity-0',
        isGroupingTarget && 'border-primary ring-2 ring-primary/30 shadow-md scale-[1.02]',
        !isDragging && !isGroupingTarget && !isDragOverlayItem && 'border-border',
        todo.completed && !isDragOverlayItem && 'opacity-60',
        isSelected && 'border-primary bg-primary/5',
      )}
    >
      {/* Insertion indicator above */}
      {insertAbove && !isDragOverlayItem && (
        <div className="absolute -top-1.5 left-3 right-3 h-[3px] rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
      )}

      {/* Insertion indicator below */}
      {insertBelow && !isDragOverlayItem && (
        <div className="absolute -bottom-1.5 left-3 right-3 h-[3px] rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
      )}

      {/* Drag Handle — hidden in overlay item */}
      {!isDragOverlayItem && (
        <Tooltip content="Drag to reorder · Drop on center to group" side="right">
          <button
            className="cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </Tooltip>
      )}

      {/* Selection Checkbox (visible in bulk select mode) */}
      {showCheckbox && !isDragOverlayItem && (
        <Checkbox
          checked={isSelected}
          onChange={() => toggleSelect(todo.id)}
          size="sm"
        />
      )}

      {/* Completion Checkbox */}
      <Tooltip content={todo.completed ? 'Mark as active' : 'Mark as done'} side="right">
        <div>
          <Checkbox
            checked={todo.completed}
            onChange={() => toggleTodo(todo.id)}
            size="md"
          />
        </div>
      </Tooltip>

      {/* Content — double-click to enter edit mode */}
      <div className="flex-1 min-w-0 mr-2">
        {isEditing ? (
          <textarea
            ref={editInputRef}
            value={editText}
            onChange={handleEditTextChange}
            onKeyDown={handleEditKeyDown}
            onBlur={handleEditSubmit}
            rows={1}
            className="w-full text-sm bg-surface-raised border border-primary rounded-lg px-2 py-0.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none overflow-hidden"
            autoFocus
          />
        ) : (
          <div>
            <span
              ref={textRef}
              onDoubleClick={() => {
                setEditingId(todo.id);
                setEditText(todo.text);
              }}
              className={cn(
                'text-sm text-text break-words whitespace-pre-line',
                !expanded && 'line-clamp-5',
                todo.completed && 'line-through text-text-tertiary',
              )}
            >
              {todo.text}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              {isOverflowing && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs text-text-tertiary hover:text-text-secondary underline decoration-dotted underline-offset-2"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
              {!isDragOverlayItem && (
                <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity select-none">
                  <Pencil className="h-3 w-3" />
                  <span>Double-click to edit</span>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right side: tags normally, delete button when editing */}
      {!isDragOverlayItem && (
        <div className="shrink-0 flex items-center gap-1.5 justify-end">
          {isEditing ? (
            <Tooltip content="Delete">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  deleteTodo(todo.id);
                  setEditingId(null);
                }}
                className="p-1.5 rounded-lg text-text-tertiary hover:bg-danger-light hover:text-danger transition-colors shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : (
            <>
              {todo.dueDate && (
                <Tooltip content={isOverdue(todo.dueDate) ? 'Overdue!' : isDueToday(todo.dueDate) ? 'Due today' : 'Due date'}>
                  <span
                    className={cn(
                      'flex items-center gap-1 text-xs whitespace-nowrap',
                      isOverdue(todo.dueDate) ? 'text-danger font-medium' : 'text-text-tertiary',
                      isDueToday(todo.dueDate) && 'text-warning font-medium',
                    )}
                  >
                    <Calendar className="h-3 w-3" />
                    {formatDueDate(todo.dueDate)}
                  </span>
                </Tooltip>
              )}
              {!hideGroupBadge && <GroupBadge groupId={todo.groupId} />}
              <CategoryBadge category={todo.category} />
              <PriorityBadge priority={todo.priority} onPriorityChange={(p) => updateTodo(todo.id, { priority: p })} />
            </>
          )}
        </div>
      )}

      {/* Tags only for drag overlay */}
      {isDragOverlayItem && (
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {todo.dueDate && (
            <Tooltip content={isOverdue(todo.dueDate) ? 'Overdue!' : isDueToday(todo.dueDate) ? 'Due today' : 'Due date'}>
              <span
                className={cn(
                  'flex items-center gap-1 text-xs whitespace-nowrap',
                  isOverdue(todo.dueDate) ? 'text-danger font-medium' : 'text-text-tertiary',
                  isDueToday(todo.dueDate) && 'text-warning font-medium',
                )}
              >
                <Calendar className="h-3 w-3" />
                {formatDueDate(todo.dueDate)}
              </span>
            </Tooltip>
          )}
          {!hideGroupBadge && <GroupBadge groupId={todo.groupId} />}
          <CategoryBadge category={todo.category} />
          <PriorityBadge priority={todo.priority} />
        </div>
      )}
    </motion.div>
  );
});