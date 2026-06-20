interface WelcomeTabProps {
  projectName: string
}

export function WelcomeTab({ projectName }: WelcomeTabProps) {
  const shortcuts = [
    { keys: 'Ctrl+P', action: 'Quick open' },
    { keys: 'Ctrl+F', action: 'Find' },
    { keys: 'Ctrl+H', action: 'Replace' },
    { keys: 'Ctrl+S', action: 'Save' },
    { keys: 'Ctrl+W', action: 'Close tab' },
    { keys: 'Ctrl+`', action: 'Terminal' },
    { keys: 'Ctrl+B', action: 'Explorer' },
    { keys: 'Ctrl+Tab', action: 'Next tab' },
  ]

  return (
    <div className="welcome-tab">
      <div className="welcome-tab__content">
        <div className="welcome-tab__header">
          <div className="welcome-tab__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <h1 className="welcome-tab__title">{projectName}</h1>
          <p className="welcome-tab__subtitle">Open a file from the explorer to start editing</p>
        </div>
        <div className="welcome-tab__shortcuts">
          <h3 className="welcome-tab__shortcuts-title">Keyboard Shortcuts</h3>
          <div className="welcome-tab__grid">
            {shortcuts.map((s) => (
              <div key={s.keys} className="welcome-tab__shortcut">
                <kbd className="welcome-tab__kbd">{s.keys}</kbd>
                <span className="welcome-tab__action">{s.action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
