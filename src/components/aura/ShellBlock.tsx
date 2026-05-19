import type { AuraShellEvent } from '../../hooks/useAura'

interface ShellBlockProps {
  shells: AuraShellEvent[]
  onViewShell?: (shellId: string) => void
}

function ShellStatusIcon({ status }: { status: AuraShellEvent['status'] }) {
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

export function ShellBlock({ shells, onViewShell }: ShellBlockProps) {
  if (!shells || shells.length === 0) return null

  return (
    <div className="shell-block__list">
      {shells.map((shell) => (
        <div
          key={shell.shellId}
          className={`shell-block shell-block--${shell.status}`}
          onClick={() => onViewShell?.(shell.shellId)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onViewShell?.(shell.shellId) }}
        >
          <ShellStatusIcon status={shell.status} />
          <span className="shell-block__name">{shell.name}</span>
          <span className="shell-block__command">{shell.command}</span>
          {shell.status === 'running' && <span className="shell-block__spinner" />}
        </div>
      ))}
    </div>
  )
}