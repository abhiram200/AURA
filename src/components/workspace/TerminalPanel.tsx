import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalInstanceProps {
  projectId: string
  terminalId: number
  isActive: boolean
  isLightMode: boolean
}

const DARK_TERMINAL_THEME = {
  background: '#0a0e17',
  foreground: '#d4d4d4',
  cursor: '#00f0ff',
  cursorAccent: '#0a0e17',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29d8f7',
  brightWhite: '#ffffff',
}

const LIGHT_TERMINAL_THEME = {
  background: '#ffffff',
  foreground: '#1e293b',
  cursor: '#0891b2',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#00bc6c',
  yellow: '#949c19',
  blue: '#0f79cc',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#1e293b',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#b5ba18',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29d8f7',
  brightWhite: '#1e293b',
}

function TerminalInstance({ projectId, terminalId, isActive, isLightMode }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)

  // Create terminal once on mount
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: isLightMode ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME,
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'bar',
    })

    const fit = new FitAddon()
    const webLinks = new WebLinksAddon()

    term.loadAddon(fit)
    term.loadAddon(webLinks)
    term.open(containerRef.current)

    try { fit.fit() } catch {}

    // Ctrl+C copies selection instead of sending ^C
    term.onKey(({ domEvent }) => {
      if (domEvent.ctrlKey && domEvent.key === 'c' && term.hasSelection()) {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          term.clearSelection()
        }
        domEvent.preventDefault()
        domEvent.stopPropagation()
        return false
      }
    })

    termRef.current = term
    fitRef.current = fit

    // Terminal input → WebSocket
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stdin', data }))
      }
    })

    return () => {
      term.dispose()
      termRef.current = null
      fitRef.current = null
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // Connect WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/terminal?projectId=${projectId}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setTimeout(() => {
        if (fitRef.current && termRef.current) {
          try {
            fitRef.current.fit()
            const dims = fitRef.current.proposeDimensions()
            if (dims) ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
          } catch {}
        }
        if (isActive && termRef.current) termRef.current.focus()
      }, 100)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'stdout') {
          termRef.current?.write(msg.data)
        } else if (msg.type === 'exit') {
          termRef.current?.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n')
        }
      } catch {}
    }

    ws.onclose = () => {
      setConnected(false)
      termRef.current?.write('\r\n\x1b[31m[Disconnected]\x1b[0m\r\n')
    }

    ws.onerror = () => {
      setConnected(false)
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [projectId])

  // Focus terminal when it becomes the active tab
  useEffect(() => {
    if (isActive && termRef.current && connected) {
      termRef.current.focus()
    }
  }, [isActive, connected])

  // Update terminal theme when light mode changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = isLightMode ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME
    }
  }, [isLightMode])

  // Resize observer
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (fitRef.current && termRef.current) {
        try {
          fitRef.current.fit()
          const dims = fitRef.current.proposeDimensions()
          if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
          }
        } catch {}
      }
    })

    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="terminal-instance" ref={containerRef}>
      {!connected && (
        <div className="terminal-instance__overlay">
          <div className="terminal-instance__connecting-text">Connecting...</div>
        </div>
      )}
    </div>
  )
}

interface TerminalPanelProps {
  projectId: string
  sessions: number[]
  activeTerminalId: number | null
  onSelectTerminal: (id: number) => void
  onCreateTerminal: () => void
  onCloseTerminal: (id: number) => void
  workspacePath: string
  isLightMode: boolean
}

export function TerminalPanel({
  projectId, sessions, activeTerminalId, onSelectTerminal, onCreateTerminal, onCloseTerminal, workspacePath, isLightMode,
}: TerminalPanelProps) {
  return (
    <div className="terminal-panel">
      <div className="terminal-panel__tabs">
        <div className="terminal-panel__tab-list">
          {sessions.map((id) => (
            <div
              key={id}
              className={`terminal-panel__tab${id === activeTerminalId ? ' terminal-panel__tab--active' : ''}`}
              onClick={() => onSelectTerminal(id)}
            >
              <span className="terminal-panel__tab-name">Terminal {id}</span>
              <button
                className="terminal-panel__tab-close"
                onClick={(e) => { e.stopPropagation(); onCloseTerminal(id) }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <button className="terminal-panel__new-btn" onClick={onCreateTerminal} title="New Terminal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div className="terminal-panel__content">
        {sessions.map((id) => (
          <div
            key={id}
            className={`terminal-panel__instance${id === activeTerminalId ? ' terminal-panel__instance--active' : ''}`}
          >
            <TerminalInstance projectId={projectId} terminalId={id} isActive={id === activeTerminalId} isLightMode={isLightMode} />
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="terminal-panel__empty">
            <button className="terminal-panel__start-btn" onClick={onCreateTerminal}>
              Start Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  )
}