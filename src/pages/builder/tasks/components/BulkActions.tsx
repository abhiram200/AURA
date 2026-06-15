import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Check, Flag, X, Layers } from 'lucide-react';
import { useTodoStore } from '../store/todoStore';
import { Checkbox } from './ui/Checkbox';
import { Tooltip } from './ui/Tooltip';
import { ALL_PRIORITIES, PRIORITY_CONFIG } from '../utils/constants';
import { getFilteredTodos, sortByOrder, getIconComponent } from '../utils/helpers';

export function BulkActions() {
  const selectedIds = useTodoStore((s) => s.selectedIds);
  const todos = useTodoStore((s) => s.todos);
  const filters = useTodoStore((s) => s.filters);
  const selectAll = useTodoStore((s) => s.selectAll);
  const clearSelection = useTodoStore((s) => s.clearSelection);
  const bulkDelete = useTodoStore((s) => s.bulkDelete);
  const bulkToggleComplete = useTodoStore((s) => s.bulkToggleComplete);
  const bulkSetPriority = useTodoStore((s) => s.bulkSetPriority);
  const bulkSetGroup = useTodoStore((s) => s.bulkSetGroup);
  const groups = useTodoStore((s) => s.groups);

  const filteredTodos = sortByOrder(getFilteredTodos(todos, filters));
  const allSelected = filteredTodos.length > 0 && filteredTodos.every((t) => selectedIds.includes(t.id));
  const someSelected = selectedIds.length > 0 && !allSelected;

  if (selectedIds.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', bounce: 0.2 }}
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface shadow-lg"
      >
        <div className="px-6 py-3 flex items-center gap-3 flex-wrap">
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            onChange={() => {
              if (allSelected) {
                clearSelection();
              } else {
                selectAll(filteredTodos.map((t) => t.id));
              }
            }}
            size="sm"
          />

          <span className="text-sm font-medium text-text">
            {selectedIds.length} selected
          </span>

          <div className="flex-1" />

          <Tooltip content="Toggle completed">
            <button
              onClick={bulkToggleComplete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-surface-raised hover:text-text transition-colors cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              Toggle done
            </button>
          </Tooltip>

          <Tooltip content="Set priority">
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-surface-raised hover:text-text transition-colors">
                <Flag className="h-3.5 w-3.5" />
                Priority
              </button>
              <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
                <div className="bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[120px]">
                  {ALL_PRIORITIES.map((p) => (
                    <button
                      key={p}
                      onClick={() => bulkSetPriority(p)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-raised transition-colors"
                      style={{ color: PRIORITY_CONFIG[p].color }}
                    >
                      {PRIORITY_CONFIG[p].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Tooltip>

          {groups.length > 0 && (
            <Tooltip content="Set group">
              <div className="relative group">
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-surface-raised hover:text-text transition-colors cursor-pointer">
                  <Layers className="h-3.5 w-3.5" />
                  Group
                </button>
                <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
                  <div className="bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                    <button
                      onClick={() => bulkSetGroup(null)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-raised transition-colors text-text-tertiary"
                    >
                      No Group
                    </button>
                    {groups.map((g) => {
                      const Icon = getIconComponent(g.icon);
                      return (
                        <button
                          key={g.id}
                          onClick={() => bulkSetGroup(g.id)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-raised transition-colors flex items-center gap-1.5"
                          style={{ color: g.color }}
                        >
                          {Icon && <Icon className="h-3 w-3" />}
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Tooltip>
          )}

          <Tooltip content="Delete selected">
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-danger hover:bg-danger-light transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </Tooltip>

          <Tooltip content="Clear selection">
            <button
              onClick={clearSelection}
              className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-raised hover:text-text transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}