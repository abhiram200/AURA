import { useEffect } from 'react';
import { useTodoStore } from '../store/todoStore';
import { getFilteredTodos, sortByOrder } from '../utils/todoHelpers';

export function useKeyboardShortcuts({
  onFocusInput,
  onFocusSearch,
  onShowShortcuts,
}: {
  onFocusInput: () => void;
  onFocusSearch: () => void;
  onShowShortcuts: () => void;
}) {
  const selectedIds = useTodoStore((s) => s.selectedIds);
  const todos = useTodoStore((s) => s.todos);
  const filters = useTodoStore((s) => s.filters);
  const selectAll = useTodoStore((s) => s.selectAll);
  const clearSelection = useTodoStore((s) => s.clearSelection);
  const bulkDelete = useTodoStore((s) => s.bulkDelete);
  const bulkToggleComplete = useTodoStore((s) => s.bulkToggleComplete);
  const setEditingId = useTodoStore((s) => s.setEditingId);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Don't trigger shortcuts when typing in inputs
      if (isInputFocused) {
        // Except Escape to blur
        if (e.key === 'Escape') {
          target.blur();
          setEditingId(null);
        }
        return;
      }

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          onFocusInput();
          break;
        case '/':
          e.preventDefault();
          onFocusSearch();
          break;
        case '?':
          e.preventDefault();
          onShowShortcuts();
          break;
        case 'Escape':
          clearSelection();
          setEditingId(null);
          break;
        default:
          break;
      }

      // Cmd/Ctrl shortcuts
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 'a':
            e.preventDefault();
            const filteredTodos = sortByOrder(getFilteredTodos(todos, filters));
            selectAll(filteredTodos.map((t) => t.id));
            break;
          case 'Delete':
          case 'Backspace':
            if (selectedIds.length > 0) {
              e.preventDefault();
              bulkDelete();
            }
            break;
          case 'd':
            e.preventDefault();
            if (selectedIds.length > 0) {
              bulkToggleComplete();
            }
            break;
          case 'k':
            e.preventDefault();
            onFocusSearch();
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    onFocusInput,
    onFocusSearch,
    onShowShortcuts,
    selectAll,
    clearSelection,
    bulkDelete,
    bulkToggleComplete,
    setEditingId,
    selectedIds,
    todos,
    filters,
  ]);
}