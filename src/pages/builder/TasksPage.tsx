import { useState, useCallback } from 'react'
import { Menu, Info } from 'lucide-react'
import { useTodoStore } from '../../store/todoStore'
import { useTaskSync } from '../../hooks/useTaskSync'
import { TodoForm } from '../../components/todo/TodoForm'
import { TodoList } from '../../components/todo/TodoList'
import { TodoSearch } from '../../components/todo/TodoSearch'
import { BulkActions } from '../../components/todo/BulkActions'
import { Sidebar } from '../../components/todo/Sidebar'
import { KeyboardShortcutsDialog } from '../../components/todo/KeyboardShortcutsDialog'
import { GroupManagerModal } from '../../components/todo/GroupManagerModal'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { Tooltip } from '../../components/todo/ui/Tooltip'

interface TasksPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  conversationId: string | null
  reportActivity?: (type: 'edit' | 'interaction') => void
  onOpenGitTree?: () => void
}

export function TasksPage({ projectId }: TasksPageProps) {
  const { loading } = useTaskSync(projectId)
  const todos = useTodoStore((s) => s.todos)
  const clearCompleted = useTodoStore((s) => s.clearCompleted)
  const selectedIds = useTodoStore((s) => s.selectedIds)

  const [showShortcuts, setShowShortcuts] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showGroupManager, setShowGroupManager] = useState(false)

  const focusFormInput = useCallback(() => {
    const input = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="What\'s next on your list?"]')
    input?.focus()
  }, [])

  const focusSearch = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Search todos..."]')
    input?.focus()
  }, [])

  useKeyboardShortcuts({
    onFocusInput: focusFormInput,
    onFocusSearch: focusSearch,
    onShowShortcuts: () => setShowShortcuts(true),
  })

  const completedCount = todos.filter((t) => t.completed).length

  if (loading) {
    return (
      <div className="tasks-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--color-text-tertiary)' }}>Loading tasks...</div>
      </div>
    )
  }

  return (
    <div className="tasks-page">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex h-full">
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
          {/* Top bar */}
          <div className="flex items-center justify-between px-6 pt-4 lg:px-8 lg:pt-6">
            {/* Mobile menu button */}
            <Tooltip content="Open menu" side="right">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg text-text-secondary hover:bg-surface-raised transition-colors lg:hidden cursor-pointer"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </Tooltip>
            <div className="hidden lg:block" />

            {/* Right-side icon buttons */}
            <div className="flex items-center gap-1">
              <Tooltip content="Help & shortcuts" side="bottom">
                <button
                  onClick={() => setShowShortcuts(true)}
                  className="flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:bg-surface-raised hover:text-text transition-colors focus-ring cursor-pointer"
                  aria-label="Help & shortcuts"
                >
                  <Info className="h-5 w-5" />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="max-w-5xl mx-auto px-6 pb-6 lg:px-8 lg:pb-8">
            {/* Add Todo Form */}
            <TodoForm />

            {/* Search */}
            <div className="mb-6">
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
  )
}