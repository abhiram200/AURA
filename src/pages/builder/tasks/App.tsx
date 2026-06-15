import { useState, useCallback, useEffect } from 'react';
import { Menu, Info } from 'lucide-react';
import { useTodoStore } from './store/todoStore';
import { TodoForm } from './components/TodoForm';
import { TodoList } from './components/TodoList';
import { TodoSearch } from './components/TodoSearch';
import { BulkActions } from './components/BulkActions';
import { Sidebar } from './components/Sidebar';
import { KeyboardShortcutsDialog } from './components/KeyboardShortcutsDialog';
import { GroupManagerModal } from './components/GroupManagerModal';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Tooltip } from './components/ui/Tooltip';

interface TasksAppProps {
  projectId: string
}

export function TasksApp({ projectId }: TasksAppProps) {
  const todos = useTodoStore((s) => s.todos);
  const clearCompleted = useTodoStore((s) => s.clearCompleted);
  const selectedIds = useTodoStore((s) => s.selectedIds);
  const isLoading = useTodoStore((s) => s.isLoading);
  const loadFromServer = useTodoStore((s) => s.loadFromServer);

  // Load tasks from server when projectId changes
  useEffect(() => {
    if (projectId) {
      loadFromServer(projectId)
    }
  }, [projectId, loadFromServer])

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showGroupManager, setShowGroupManager] = useState(false);

  const focusFormInput = useCallback(() => {
    const input = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="What\'s next on your list?"]');
    input?.focus();
  }, []);

  const focusSearch = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Search todos..."]');
    input?.focus();
  }, []);

  useKeyboardShortcuts({
    onFocusInput: focusFormInput,
    onFocusSearch: focusSearch,
    onShowShortcuts: () => setShowShortcuts(true),
  });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  if (isLoading) {
    return (
      <div className="tasks-app h-full overflow-hidden bg-surface transition-colors duration-300 flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-text-tertiary">
          <div style={{ width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'pm-spin 0.8s linear infinite' }} />
          <span className="text-sm">Loading tasks...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="tasks-app h-full overflow-hidden bg-surface transition-colors duration-300 flex flex-col">
      {/* Full-width top bar — matches builder header style */}
      <div className="flex items-center gap-3 px-4 h-10 flex-shrink-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
        {/* Tasks icon — same clipboard+checkmark as the tab */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-primary, #7c3aed)' }} className="flex-shrink-0">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Tasks</span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary, #6b7280)' }}>
          {activeCount} remaining · {completedCount} done
        </span>

        <div className="flex-1" />

        {/* Right-side controls */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 rounded-md transition-colors lg:hidden cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4" />
        </button>
        <Tooltip content="Help & shortcuts" side="bottom">
          <button
            onClick={() => setShowShortcuts(true)}
            className="flex items-center justify-center w-7 h-7 rounded-md transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Help & shortcuts"
          >
            <Info className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 min-h-0">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar - desktop */}
        <aside className="hidden lg:flex w-80 flex-shrink-0">
          <Sidebar onManageGroups={() => setShowGroupManager(true)} />
        </aside>

        {/* Sidebar - mobile overlay */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-80 transform transition-transform duration-300 lg:hidden ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} onManageGroups={() => { setSidebarOpen(false); setShowGroupManager(true); }} />
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 pt-4 pb-6 lg:px-8 lg:pt-6 lg:pb-8">
            {/* Add Todo Form — grouped as one visual unit */}
            <div className="rounded-xl border border-border bg-surface-raised/50 p-4 mb-6">
              <TodoForm />
            </div>

            {/* Search */}
            <div className="mb-4">
              <TodoSearch />
            </div>

            {/* Todo List */}
            <TodoList />

            {/* Footer */}
            {completedCount > 0 && (
              <div className="flex justify-center pt-4 pb-2">
                <Tooltip content="Remove all completed todos" side="top">
                  <button
                    onClick={clearCompleted}
                    className="text-xs text-text-tertiary hover:text-danger transition-colors cursor-pointer"
                  >
                    Clear {completedCount} completed {completedCount === 1 ? 'todo' : 'todos'}
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && <BulkActions />}

      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Group Manager Modal */}
      <GroupManagerModal
        isOpen={showGroupManager}
        onClose={() => setShowGroupManager(false)}
      />
    </div>
  );
}