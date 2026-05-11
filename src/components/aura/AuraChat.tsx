import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AuraChatMessage, AuraToolCall, AuraSubAgentInfo } from '../../hooks/useAura'

interface AuraChatProps {
  messages: AuraChatMessage[]
  isStreaming: boolean
  isCompacting: boolean
  error: string | null
  onAsk: (prompt: string) => void
  onClearError: () => void
}

function StatusDot({ status }: { status: 'running' | 'completed' | 'error' }) {
  const className = status === 'completed' ? 'aura-chat__status-dot aura-chat__status-dot--done'
    : status === 'running' ? 'aura-chat__status-dot aura-chat__status-dot--running'
    : 'aura-chat__status-dot aura-chat__status-dot--error'
  return <span className={className} />
}

function ToolCallSection({ tc }: { tc: AuraToolCall }) {
  const purpose = tc.purpose || tc.name
  const statusClass = tc.status === 'completed' ? 'aura-chat__status-text--done'
    : tc.status === 'running' ? 'aura-chat__status-text--running'
    : 'aura-chat__status-text--error'
  return (
    <details className="aura-chat__tool-call">
      <summary className="aura-chat__tool-call-header">
        <StatusDot status={tc.status} />
        <span className={`aura-chat__tool-call-name ${statusClass}`}>{purpose}</span>
      </summary>
      <div className="aura-chat__tool-call-details">
        {tc.thinking && (
          <div className="aura-chat__tool-call-thinking">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              code({ className, children }) {
                const isBlock = className?.startsWith('language-') || String(children).includes('\n')
                if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>
                return <code className="aura-chat__inline-code">{children}</code>
              },
              pre({ children }) { return <>{children}</> },
              p({ children }) { return <span>{children}</span> },
            }}>
              {tc.thinking}
            </ReactMarkdown>
          </div>
        )}
        <div className="aura-chat__tool-call-args">
          <span className="aura-chat__tool-call-label">Args:</span>
          <pre>{JSON.stringify(tc.args, null, 2)}</pre>
        </div>
        {tc.result !== undefined && (
          <div className="aura-chat__tool-call-result">
            <span className="aura-chat__tool-call-label">Result:</span>
            <pre>{typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2).slice(0, 2000)}</pre>
          </div>
        )}
        {tc.error && (
          <div className="aura-chat__tool-call-error">
            <span className="aura-chat__tool-call-label">Error:</span> {tc.error}
          </div>
        )}
      </div>
    </details>
  )
}

function SubAgentSection({ sa }: { sa: AuraSubAgentInfo }) {
  const statusClass = sa.status === 'completed' ? 'aura-chat__status-text--done'
    : sa.status === 'running' ? 'aura-chat__status-text--running'
    : 'aura-chat__status-text--error'
  return (
    <details className="aura-chat__sub-agent">
      <summary className="aura-chat__sub-agent-header">
        <StatusDot status={sa.status} />
        <span className={`aura-chat__sub-agent-task ${statusClass}`}>
          Agent({sa.task})
        </span>
      </summary>
      {sa.result && (
        <div className="aura-chat__sub-agent-result">
          <pre>{sa.result.slice(0, 2000)}</pre>
        </div>
      )}
    </details>
  )
}

function SubAgentsGroup({ subAgents }: { subAgents: AuraSubAgentInfo[] }) {
  if (subAgents.length <= 1) {
    return (
      <div className="aura-chat__sub-agents">
        {subAgents.map((sa, i) => (
          <SubAgentSection key={`${sa.taskId}-${i}`} sa={sa} />
        ))}
      </div>
    )
  }

  const completed = subAgents.filter(sa => sa.status === 'completed').length
  const running = subAgents.filter(sa => sa.status === 'running').length

  let statusLabel = ''
  if (running > 0) statusLabel = `${running} running`
  else if (completed === subAgents.length) statusLabel = 'all done'

  const label = `${subAgents.length} agents${statusLabel ? ` · ${statusLabel}` : ''}`
  const groupStatus = running > 0 ? 'running' : 'completed'
  const groupStatusClass = groupStatus === 'completed' ? 'aura-chat__status-text--done' : 'aura-chat__status-text--running'

  return (
    <details className="aura-chat__sub-agents-group">
      <summary className="aura-chat__sub-agents-group-header">
        <StatusDot status={groupStatus} />
        <span className={`aura-chat__sub-agents-group-label ${groupStatusClass}`}>{label}</span>
      </summary>
      <div className="aura-chat__sub-agents-group-list">
        {subAgents.map((sa, i) => (
          <SubAgentSection key={`${sa.taskId}-${i}`} sa={sa} />
        ))}
      </div>
    </details>
  )
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const lang = className?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [code])

  return (
    <div className="aura-chat__code-block">
      <div className="aura-chat__code-header">
        <span className="aura-chat__code-lang">{lang || 'code'}</span>
        <button className="aura-chat__code-copy" onClick={handleCopy}>
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
      <pre className="aura-chat__code-pre"><code>{code}</code></pre>
    </div>
  )
}

function ToolCallsGroup({ toolCalls }: { toolCalls: AuraToolCall[] }) {
  if (toolCalls.length <= 1) {
    return (
      <div className="aura-chat__tool-calls">
        {toolCalls.map((tc, i) => (
          <ToolCallSection key={`${tc.name}-${i}`} tc={tc} />
        ))}
      </div>
    )
  }

  const completed = toolCalls.filter(tc => tc.status === 'completed').length
  const running = toolCalls.filter(tc => tc.status === 'running').length
  const errored = toolCalls.filter(tc => tc.status === 'error').length

  let statusLabel = ''
  if (running > 0) statusLabel = `${running} running`
  else if (errored === toolCalls.length) statusLabel = 'all errored'
  else if (completed === toolCalls.length) statusLabel = 'all done'

  const label = `${toolCalls.length} tool calls${statusLabel ? ` · ${statusLabel}` : ''}`
  const groupStatus = running > 0 ? 'running' : errored > 0 ? 'error' : 'completed'
  const groupStatusClass = groupStatus === 'completed' ? 'aura-chat__status-text--done'
    : groupStatus === 'running' ? 'aura-chat__status-text--running'
    : 'aura-chat__status-text--error'

  return (
    <details className="aura-chat__tool-calls-group">
      <summary className="aura-chat__tool-calls-group-header">
        <StatusDot status={groupStatus} />
        <span className={`aura-chat__tool-calls-group-label ${groupStatusClass}`}>{label}</span>
      </summary>
      <div className="aura-chat__tool-calls-group-list">
        {toolCalls.map((tc, i) => (
          <ToolCallSection key={`${tc.name}-${i}`} tc={tc} />
        ))}
      </div>
    </details>
  )
}

function ChatMessage({ msg }: { msg: AuraChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`aura-chat__message ${isUser ? 'aura-chat__message--user' : 'aura-chat__message--assistant'}`}>
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
        <ToolCallsGroup toolCalls={msg.toolCalls} />
      )}
      {!isUser && msg.subAgents && msg.subAgents.length > 0 && (
        <SubAgentsGroup subAgents={msg.subAgents} />
      )}
      <div className="aura-chat__message-content">
        {isUser ? (
          msg.content
        ) : (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              code({ className, children }) {
                const isBlock = className?.startsWith('language-') || String(children).includes('\n')
                if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>
                return <code className="aura-chat__inline-code">{children}</code>
              },
              pre({ children }) {
                return <>{children}</>
              },
            }}>
              {msg.content}
            </ReactMarkdown>
            {msg.content === '' && (!msg.toolCalls || msg.toolCalls.length === 0) && (!msg.subAgents || msg.subAgents.length === 0) && (
              <span className="aura-chat__cursor" />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function AuraChat({ messages, isStreaming, isCompacting, error, onAsk, onClearError }: AuraChatProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming || isCompacting) return
    onAsk(trimmed)
    setInput('')
    inputRef.current?.focus()
  }, [input, isStreaming, isCompacting, onAsk])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }, [])

  return (
    <div className="aura-chat">
      <div className="aura-chat__messages">
        {messages.length === 0 && (
          <div className="aura-chat__empty">
            <span className="aura-chat__empty-icon">&gt;_</span>
            <p>Ask a question about your codebase</p>
            <p className="aura-chat__empty-hint">
              Try: "How does the indexer work?" or "What breaks if I change X?"
            </p>
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} msg={msg} />
        ))}
        {isCompacting && (
          <div className="aura-chat__compacting">
            <span className="aura-chat__compacting-spinner" />
            <span>Compacting conversation...</span>
          </div>
        )}
        {isStreaming && !isCompacting && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content !== '' && (
          <div className="aura-chat__streaming">
            <span className="aura-chat__cursor" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="aura-chat__error">
          <span>{error}</span>
          <button className="aura-chat__error-dismiss" onClick={onClearError}>×</button>
        </div>
      )}

      <div className="aura-chat__input-area">
        <span className="aura-chat__input-prompt">&gt;</span>
        <textarea
          ref={inputRef}
          className="aura-chat__input"
          value={input}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? (isCompacting ? 'Compacting conversation...' : 'Waiting for response...') : 'Ask about your codebase...'}
          rows={1}
        />
        <button
          className="aura-chat__send-btn"
          onClick={handleSend}
          disabled={isStreaming || isCompacting || !input.trim()}
        >
          ↵
        </button>
      </div>
    </div>
  )
}