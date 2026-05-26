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

// Strip \r from PTY output — xterm with convertEol handles \n properly,
// and \r\n would become a double line break without this.
function sanitizeForXterm(data: string): string {
  return data.replace(/\r\n/g, '\n')
}

export function ManagedTerminalPanel({ shell, projectId, onDismiss, onTerminate, onClose, isLight }: ManagedTerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const writtenLenRef = useRef(0)
  const fetchedRef = useRef(false)

  // Fetch full output from REST API on mount, then poll for new data
  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true

      fetch(`/api/managed-shells/${projectId}/${shell.id}/output`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data?.recentOutput) return
          const term = xtermRef.current
          if (!term) return

          const output = sanitizeForXterm(data.recentOutput)
          if (output) {
            term.write(output)
            writtenLenRef.current = output.length
          }
        })
        .catch(() => {})
    }
  }, [projectId, shell.id])

  // Create xterm.js terminal
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
      customKeyEventHandler: (e) => {
        if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
          const selection = term.getSelection()
          if (selection) {
            navigator.clipboard.writeText(selection)
            term.clearSelection()
          }
          e.preventDefault()
          return false
        }
        return true
      },
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

  // Write new SSE output incrementally (only what hasn't been written yet)
  useEffect(() => {
    const term = xtermRef.current
    if (!term || !fetchedRef.current) return

    if (shell.output.length > writtenLenRef.current) {
      const newOutput = sanitizeForXterm(shell.output.slice(writtenLenRef.current))
      if (newOutput) {
        term.write(newOutput)
      }
      writtenLenRef.current = shell.output.length
    }
  }, [shell.output])

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