interface WelcomeTabProps {
  projectName: string
}

export function WelcomeTab({ projectName }: WelcomeTabProps) {
  const shortcuts = [
    { keys: 'Ctrl + S', action: 'Save file' },
    { keys: 'Ctrl + W', action: 'Close tab' },
    { keys: 'Ctrl + `', action: 'Toggle terminal' },
    { keys: 'Ctrl + B', action: 'Toggle explorer' },
    { keys: 'Ctrl + Tab', action: 'Next tab' },
    { keys: 'Ctrl + Shift+Tab', action: 'Previous tab' },
  ]

  return (
    <div className="welcome-tab">
      <div className="welcome-tab__content">
        <div className="welcome-tab__icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
        </div>
        <h1 className="welcome-tab__title">{projectName}</h1>
        <p className="welcome-tab__subtitle">Open a file from the explorer to start editing</p>
        <div className="welcome-tab__shortcuts">
          <h3 className="welcome-tab__shortcuts-title">Keyboard Shortcuts</h3>
          {shortcuts.map((s) => (
            <div key={s.keys} className="welcome-tab__shortcut">
              <kbd className="welcome-tab__kbd">{s.keys}</kbd>
              <span className="welcome-tab__action">{s.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}