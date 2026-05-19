import type { AuraShellEvent } from '../../hooks/useAura'
import type { ManagedShellState } from '../../hooks/useManagedShells'

interface ShellBlockProps {
  shells: AuraShellEvent[]
  liveShells?: Map<string, ManagedShellState>
  onViewShell?: (shellId: string) => void
}

function ShellStatusIcon({ status }: { status: 'running' | 'completed' | 'failed' | 'killed' }) {
  if (status === 'running') {
    return <span className="shell-block__icon shell-block__icon--running">⏳</span>
  }
  if (status === 'completed') {
    return <span className="shell-block__icon shell-block__icon--completed">✓</span>
  }
  if (status === 'failed') {
    return <span className="shell-block__icon shell-block__icon--failed">✗</span>
  }
  return <span className="shell-block__icon shell-block__icon--killed">⊘</span>
}

export function ShellBlock({ shells, liveShells, onViewShell }: ShellBlockProps) {
  if (!shells || shells.length === 0) return null

  return (
    <div className="shell-block__list">
      {shells.map((shell) => {
        // Prefer live status from useManagedShells over frozen message data
        const liveShell = liveShells?.get(shell.shellId)
        const status = liveShell ? liveShell.status : shell.status
        return (
          <div
            key={shell.shellId}
            className={`shell-block shell-block--${status}`}
            onClick={() => onViewShell?.(shell.shellId)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onViewShell?.(shell.shellId) }}
          >
            <ShellStatusIcon status={status} />
            <span className="shell-block__name">{shell.name}</span>
            <span className="shell-block__command">{shell.command}</span>
            {status === 'running' && <span className="shell-block__spinner" />}
          </div>
        )
      })}
    </div>
  )
}