import { useTheme } from '../../hooks/useTheme'

interface TasksPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  conversationId: string | null
  reportActivity?: (type: 'edit' | 'interaction') => void
  onOpenGitTree?: () => void
}

export function TasksPage({ projectName }: TasksPageProps) {
  const { theme } = useTheme()
  const isLight = theme === 'light'

  return (
    <div
      className="tasks-page"
      style={{
        '--tasks-bg': isLight ? '#ffffff' : 'var(--bg-primary)',
        '--tasks-fg': isLight ? '#1a1a2e' : 'var(--text-primary)',
        '--tasks-muted': isLight ? '#666' : 'var(--text-tertiary)',
        '--tasks-border': isLight ? '#d0d0d0' : 'var(--border-color)',
      } as React.CSSProperties}
    >
      <div className="tasks-page__empty">
        <div className="tasks-page__empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 14l2 2 4-4" />
          </svg>
        </div>
        <h2 className="tasks-page__empty-title">Tasks</h2>
        <p className="tasks-page__empty-subtitle">Manage your project tasks and to-dos — coming soon</p>
      </div>
    </div>
  )
}