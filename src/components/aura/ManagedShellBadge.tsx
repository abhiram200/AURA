import { useState, useRef, useEffect } from 'react'
import type { ManagedShellState } from '../../hooks/useManagedShells'

interface ManagedShellBadgeProps {
  activeShells: ManagedShellState[]
  allShells: ManagedShellState[]
  onViewShell: (shellId: string) => void
  onTerminateShell: (shellId: string) => void
  onDismissShell: (shellId: string) => void
}

function ShellStatusIcon({ status }: { status: ManagedShellState['status'] }) {
  if (status === 'running') return <span className="ms-badge__status ms-badge__status--running">●</span>
  if (status === 'completed') return <span className="ms-badge__status ms-badge__status--completed">✓</span>
  if (status === 'failed') return <span className="ms-badge__status ms-badge__status--failed">✗</span>
  return <span className="ms-badge__status ms-badge__status--killed">⊘</span>
}

export function ManagedShellBadge({ activeShells, allShells, onViewShell, onTerminateShell, onDismissShell }: ManagedShellBadgeProps) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (allShells.length === 0) return null

  return (
    <div className="ms-badge" ref={dropdownRef}>
      <button
        className={`ms-badge__trigger ${activeShells.length > 0 ? 'ms-badge__trigger--active' : ''}`}
        onClick={() => setOpen(!open)}
        title={`${activeShells.length} active shell${activeShells.length !== 1 ? 's' : ''}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        {activeShells.length > 0 && (
          <span className="ms-badge__count">{activeShells.length}</span>
        )}
      </button>
      {open && (
        <div className="ms-badge__dropdown">
          <div className="ms-badge__dropdown-header">
            Background Shells
          </div>
          {allShells.length === 0 ? (
            <div className="ms-badge__empty">No shells</div>
          ) : (
            allShells.map(shell => (
              <div key={shell.id} className={`ms-badge__shell-item ms-badge__shell-item--${shell.status}`}>
                <ShellStatusIcon status={shell.status} />
                <div className="ms-badge__shell-info" onClick={() => { onViewShell(shell.id); setOpen(false) }}>
                  <span className="ms-badge__shell-name">{shell.name}</span>
                  <span className="ms-badge__shell-command">{shell.command}</span>
                </div>
                <div className="ms-badge__shell-actions">
                  {shell.status === 'running' && (
                    <button
                      className="ms-badge__shell-btn ms-badge__shell-btn--terminate"
                      onClick={(e) => { e.stopPropagation(); onTerminateShell(shell.id) }}
                      title="Terminate"
                    >
                      ■
                    </button>
                  )}
                  {shell.status !== 'running' && (
                    <button
                      className="ms-badge__shell-btn ms-badge__shell-btn--dismiss"
                      onClick={(e) => { e.stopPropagation(); onDismissShell(shell.id) }}
                      title="Dismiss"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}