import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ManagedShellState } from '../../hooks/useManagedShells'
import '@xterm/xterm/css/xterm.css'

interface ManagedTerminalPanelProps {
  shell: ManagedShellState
  projectId: string
  onDismiss: (shellId: string) => void
  onTerminate: (shellId: string) => void
  onClose: () => void
  isLight: boolean
}

export function ManagedTerminalPanel({ shell, projectId, onDismiss, onTerminate, onClose, isLight }: ManagedTerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Track how many chars we've written to xterm.js — separate from shell.output
  // to avoid double-text when fetchShellOutput replaces state and SSE re-appends
  const writtenLenRef = useRef(0)
  const [initialOutput, setInitialOutput] = useState<string | null>(null)

  // Fetch full output from REST API on mount (before SSE might have missed some)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/managed-shells/${projectId}/${shell.id}/output`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data?.recentOutput) {
          setInitialOutput(data.recentOutput)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId, shell.id])

  // Create xterm.js terminal and write the initial output
  useEffect(() => {
    if (!termRef.current || xtermRef.current) return

    const term = new Terminal({
      theme: isLight
        ? { background: '#fafafa', foreground: '#383a42', cursor: '#526fff', selectionBackground: '#add6ff' }
        : { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
      fontSize: 13,
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(termRef.current)
    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    xtermRef.current = term
    fitRef.current = fitAddon

    return () => {
      term.dispose()
      xtermRef.current = null
      fitRef.current = null
    }
  }, [isLight])

  // Write initial output to xterm.js when fetched (only once)
  useEffect(() => {
    const term = xtermRef.current
    if (!term || initialOutput === null) return

    // Use the longer of: fetched API output or SSE-accumulated output
    const output = initialOutput.length >= shell.output.length ? initialOutput : shell.output
    if (output) {
      term.write(output)
      writtenLenRef.current = output.length
    }
  }, [initialOutput]) // eslint-disable-line react-hooks/exhaustive-deps

  // Write new SSE output incrementally (only what hasn't been written yet)
  useEffect(() => {
    const term = xtermRef.current
    if (!term || initialOutput === null) return // wait for initial fetch

    if (shell.output.length > writtenLenRef.current) {
      const newOutput = shell.output.slice(writtenLenRef.current)
      term.write(newOutput)
      writtenLenRef.current = shell.output.length
    }
  }, [shell.output, initialOutput])

  useEffect(() => {
    const handleResize = () => {
      fitRef.current?.fit()
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handlePanelClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const statusLabel = shell.status === 'running' ? 'Running'
    : shell.status === 'completed' ? `Completed (exit ${shell.exitCode})`
    : shell.status === 'failed' ? `Failed (exit ${shell.exitCode})`
    : 'Terminated'

  const statusClass = shell.status === 'running' ? 'mtp__status--running'
    : shell.status === 'completed' ? 'mtp__status--completed'
    : shell.status === 'failed' ? 'mtp__status--failed'
    : 'mtp__killed'

  return (
    <div className="mtp-overlay" onClick={onClose}>
      <div className="mtp-popup" onClick={handlePanelClick}>
        <div className="mtp__header">
          <div className="mtp__header-left">
            <span className="mtp__name">{shell.name}</span>
            <span className={`mtp__status ${statusClass}`}>{statusLabel}</span>
          </div>
          <div className="mtp__header-right">
            {shell.status === 'running' && (
              <button className="mtp__btn mtp__btn--terminate" onClick={() => onTerminate(shell.id)}>
                Terminate
              </button>
            )}
            {shell.status !== 'running' && (
              <button className="mtp__btn mtp__btn--dismiss" onClick={() => onDismiss(shell.id)}>
                Dismiss
              </button>
            )}
            <button className="mtp__btn mtp__btn--close" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="mtp__command">{shell.command}</div>
        <div className="mtp__terminal" ref={termRef} />
      </div>
    </div>
  )
}