import { useState, useEffect, useCallback, useMemo, useRef, memo, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AuraChatMessage, AuraToolCall, AuraSubAgentInfo, AuraTodoItem, AuraApprovalRequest } from '../../hooks/useAura'
import type { ManagedShellState } from '../../hooks/useManagedShells'
import { ShellBlock } from './ShellBlock'

interface AuraChatProps {
  messages: AuraChatMessage[]
  isStreaming: boolean
  error: string | null
  onAsk: (prompt: string) => void
  onClearError: () => void
  pendingApproval: AuraApprovalRequest | null
  onRespondToApproval: (approvalId: string, approved: boolean, feedback?: string) => void
  onViewShell?: (shellId: string) => void
  liveShells?: Map<string, ManagedShellState>
  isActive?: boolean
  focusTrigger?: number
}

function StatusDot({ status }: { status: 'running' | 'completed' | 'error' }) {
  const className = status === 'completed' ? 'aura-chat__status-dot aura-chat__status-dot--done'
    : status === 'running' ? 'aura-chat__status-dot aura-chat__status-dot--running'
    : 'aura-chat__status-dot aura-chat__status-dot--error'
  return <span className={className} />
}

const ToolCallSection = memo(function ToolCallSection({ tc }: { tc: AuraToolCall }) {
  const purpose = tc.purpose || tc.name
  const statusClass = tc.status === 'completed' ? 'aura-chat__status-text--done'
    : tc.status === 'running' ? 'aura-chat__status-text--running'
    : 'aura-chat__status-text--error'

  const resultPreview = useMemo(() => {
    if (tc.result === undefined) return null
    return typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2).slice(0, 2000)
  }, [tc.result])

  const argsPreview = useMemo(() => {
    return JSON.stringify(tc.args, null, 2)
  }, [tc.args])

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
              a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> },
            }}>
              {tc.thinking}
            </ReactMarkdown>
          </div>
        )}
        <div className="aura-chat__tool-call-args">
          <span className="aura-chat__tool-call-label">Args:</span>
          <pre>{argsPreview}</pre>
        </div>
        {resultPreview !== null && (
          <div className="aura-chat__tool-call-result">
            <span className="aura-chat__tool-call-label">Result:</span>
            <pre>{resultPreview}</pre>
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
})

const SUB_AGENT_TYPE_LABELS: Record<string, string> = {
  explore: 'Explorer',
  research: 'Researcher',
  fix: 'Fixer',
  plan: 'Planner',
}

const SubAgentSection = memo(function SubAgentSection({ sa }: { sa: AuraSubAgentInfo }) {
  const statusClass = sa.status === 'completed' ? 'aura-chat__status-text--done'
    : sa.status === 'running' ? 'aura-chat__status-text--running'
    : 'aura-chat__status-text--error'
  const typeLabel = SUB_AGENT_TYPE_LABELS[sa.type || 'explore'] || 'Agent'
  return (
    <details className="aura-chat__sub-agent">
      <summary className="aura-chat__sub-agent-header">
        <StatusDot status={sa.status} />
        <span className={`aura-chat__sub-agent-task ${statusClass}`}>
          {sa.title ? `${typeLabel}(${sa.title})` : `${typeLabel}(${sa.task.split('\n')[0].slice(0, 60)}…)`}
        </span>
      </summary>
      {sa.result && (
        <div className="aura-chat__sub-agent-result">
          <pre>{sa.result}</pre>
        </div>
      )}
    </details>
  )
})

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
    <details className="aura-chat__sub-agents-group" open={running > 0}>
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

function TodoListSection({ todos }: { todos: AuraTodoItem[] }) {
  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0
  const allDone = completed === total

  return (
    <details className="aura-chat__todo-list" open={!allDone}>
      <summary className="aura-chat__todo-list-header">
        <StatusDot status={allDone ? 'completed' : 'running'} />
        <span className="aura-chat__todo-list-label">
          Build Progress: {completed}/{total}
        </span>
        <div className="aura-chat__todo-progress-bar">
          <div className="aura-chat__todo-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </summary>
      <div className="aura-chat__todo-items">
        {todos.map(todo => (
          <div key={todo.id} className={`aura-chat__todo-item aura-chat__todo-item--${todo.status}`}>
            <span className="aura-chat__todo-status">
              {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '▶' : '○'}
            </span>
            <span className="aura-chat__todo-subject">{todo.subject}</span>
          </div>
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
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
      <pre className="aura-chat__code-pre"><code>{code}</code></pre>
    </div>
  )
}

const MarkdownComponents = {
  code({ className, children }: { className?: string; children?: React.ReactNode }) {
    const isBlock = className?.startsWith('language-') || String(children).includes('\n')
    if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>
    return <code className="aura-chat__inline-code">{children}</code>
  },
  pre({ children }: { children?: React.ReactNode }) { return <>{children}</> },
  p({ children }: { children?: React.ReactNode }) { return <span>{children}</span> },
  a({ href, children }: { href?: string; children?: React.ReactNode }) { return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> },
}

const RemarkPlugins = [remarkGfm]

const ChatMessage = memo(function ChatMessage({ msg, onViewShell, liveShells }: { msg: AuraChatMessage; onViewShell?: (shellId: string) => void; liveShells?: Map<string, ManagedShellState> }) {
  const isUser = msg.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [msg.content])

  return (
    <div className={`aura-chat__message ${isUser ? 'aura-chat__message--user' : 'aura-chat__message--assistant'}`}>
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
        <ToolCallsGroup toolCalls={msg.toolCalls} />
      )}
      {!isUser && msg.subAgents && msg.subAgents.length > 0 && (
        <SubAgentsGroup subAgents={msg.subAgents} />
      )}
      {!isUser && msg.todos && msg.todos.length > 0 && (
        <TodoListSection todos={msg.todos} />
      )}
      {!isUser && msg.shells && msg.shells.length > 0 && (
        <ShellBlock shells={msg.shells} liveShells={liveShells} onViewShell={onViewShell} />
      )}
      <div className="aura-chat__message-content">
        {isUser ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
        ) : (
          <>
            <ReactMarkdown remarkPlugins={RemarkPlugins} components={MarkdownComponents}>
              {msg.content}
            </ReactMarkdown>
            {msg.content === '' && (!msg.toolCalls || msg.toolCalls.length === 0) && (!msg.subAgents || msg.subAgents.length === 0) && (
              <span className="aura-chat__cursor" />
            )}
          </>
        )}
      </div>
      {isUser && (
        <button className="aura-chat__copy-btn" onClick={handleCopy} title="Copy message">
          {copied ? '✓' : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}, (prev, next) => {
  if (prev.msg.id !== next.msg.id) return false
  if (prev.msg.content !== next.msg.content) return false
  if (prev.msg.role !== next.msg.role) return false
  if (prev.onViewShell !== next.onViewShell) return false
  // Deep compare toolCalls, subAgents, todos, shells
  const prevTc = prev.msg.toolCalls
  const nextTc = next.msg.toolCalls
  if (prevTc?.length !== nextTc?.length) return false
  if (prevTc && nextTc) {
    for (let i = 0; i < prevTc.length; i++) {
      if (prevTc[i].status !== nextTc[i].status || prevTc[i].result !== nextTc[i].result || prevTc[i].error !== nextTc[i].error) return false
    }
  }
  const prevSa = prev.msg.subAgents
  const nextSa = next.msg.subAgents
  if (prevSa?.length !== nextSa?.length) return false
  if (prevSa && nextSa) {
    for (let i = 0; i < prevSa.length; i++) {
      if (prevSa[i].status !== nextSa[i].status || prevSa[i].result !== nextSa[i].result) return false
    }
  }
  const prevTodos = prev.msg.todos
  const nextTodos = next.msg.todos
  if (prevTodos?.length !== nextTodos?.length) return false
  if (prevTodos && nextTodos) {
    for (let i = 0; i < prevTodos.length; i++) {
      if (prevTodos[i].status !== nextTodos[i].status) return false
    }
  }
  // Only re-render if liveShells has entries relevant to this message's shells
  if (prev.msg.shells?.length && next.liveShells) {
    for (const s of prev.msg.shells) {
      const prevShell = prev.liveShells?.get(s.shellId)
      const nextShell = next.liveShells?.get(s.shellId)
      if (prevShell?.status !== nextShell?.status || prevShell?.exitCode !== nextShell?.exitCode) return false
    }
  }
  return true
})

function ApprovalCard({ request, onRespond }: { request: AuraApprovalRequest; onRespond: (approved: boolean, feedback?: string) => void }) {
  const [editText, setEditText] = useState('')
  const [showEdit, setShowEdit] = useState(false)

  if (request.type === 'command') {
    const riskClass = request.riskLevel === 'high' ? 'aura-chat__approval-risk--high' : 'aura-chat__approval-risk--medium'
    return (
      <div className="aura-chat__approval-card">
        <div className="aura-chat__approval-type">
          Command Approval
          {request.riskLevel && (
            <span className={`aura-chat__approval-risk ${riskClass}`}>
              {request.riskLevel === 'high' ? '⚠ High Risk' : '⚡ Medium Risk'}
            </span>
          )}
        </div>
        <div className="aura-chat__approval-details">
          {request.description && (
            <div className="aura-chat__approval-description">{request.description}</div>
          )}
          <div className="aura-chat__approval-label">Command:</div>
          <pre className="aura-chat__approval-code">{request.command}</pre>
          {request.cwd && (
            <div className="aura-chat__approval-label">Working directory: <code>{request.cwd}</code></div>
          )}
        </div>
        <div className="aura-chat__approval-actions">
          <button className="aura-chat__approval-btn aura-chat__approval-btn--approve" onClick={() => onRespond(true)}>Approve</button>
          <button className="aura-chat__approval-btn aura-chat__approval-btn--deny" onClick={() => onRespond(false)}>Deny</button>
        </div>
      </div>
    )
  }

  if (request.type === 'plan') {
    return (
      <div className="aura-chat__approval-card">
        <div className="aura-chat__approval-type">Plan Review</div>
        <div className="aura-chat__approval-details">
          <ReactMarkdown remarkPlugins={RemarkPlugins} components={MarkdownComponents}>
            {request.planMarkdown || ''}
          </ReactMarkdown>
        </div>
        {!showEdit ? (
          <div className="aura-chat__approval-actions">
            <button className="aura-chat__approval-btn aura-chat__approval-btn--approve" onClick={() => onRespond(true)}>Accept Plan</button>
            <button className="aura-chat__approval-btn aura-chat__approval-btn--edit" onClick={() => setShowEdit(true)}>Suggest Edits</button>
          </div>
        ) : (
          <div className="aura-chat__approval-edit">
            <textarea
              className="aura-chat__approval-feedback"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              placeholder="Describe your suggested changes to the plan..."
              rows={4}
            />
            <div className="aura-chat__approval-actions">
              <button className="aura-chat__approval-btn aura-chat__approval-btn--approve" onClick={() => onRespond(true, editText)}>Accept with Edits</button>
              <button className="aura-chat__approval-btn aura-chat__approval-btn--deny" onClick={() => onRespond(false, editText)}>Reject with Edits</button>
              <button className="aura-chat__approval-btn" onClick={() => setShowEdit(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (request.type === 'question') {
    return (
      <div className="aura-chat__approval-card">
        <div className="aura-chat__approval-type">Question</div>
        <div className="aura-chat__approval-details">
          <p>{request.question}</p>
        </div>
        <div className="aura-chat__approval-actions">
          {(request.options || []).map((option, idx) => (
            <button
              key={idx}
              className="aura-chat__approval-btn aura-chat__approval-btn--option"
              onClick={() => onRespond(true, option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return null
}

export default function AuraChat({ messages, isStreaming, error, onAsk, onClearError, pendingApproval, onRespondToApproval, onViewShell, liveShells, isActive, focusTrigger }: AuraChatProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingApproval])

  // Auto-focus input on mount, when tab becomes active, or after new chat
  useEffect(() => {
    if (isActive !== false) {
      inputRef.current?.focus()
    }
  }, [isActive, focusTrigger])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onAsk(trimmed)
    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
    inputRef.current?.focus()
  }, [input, isStreaming, onAsk])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [])

  return (
    <div className="aura-chat">
      <div className="aura-chat__messages">
        {messages.length === 0 && (
          <div className="aura-chat__empty">
            <span className="aura-chat__empty-icon">&gt;_</span>
            <p>Ask me to build, fix, or investigate your codebase</p>
            <p className="aura-chat__empty-hint">
              Try: "Build an auth module" or "How does the indexer work?"
            </p>
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} msg={msg} onViewShell={onViewShell} liveShells={liveShells} />
        ))}
        {isStreaming && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content !== '' && (
          <div className="aura-chat__streaming">
            <span className="aura-chat__cursor" />
          </div>
        )}
        {pendingApproval && (
          <ApprovalCard
            request={pendingApproval}
            onRespond={(approved, feedback) => onRespondToApproval(pendingApproval.id, approved, feedback)}
          />
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
          placeholder={isStreaming ? 'Building...' : 'Ask me to build, fix, or investigate...'}
          rows={1}
        />
        <button
          className="aura-chat__send-btn"
          onClick={handleSend}
          disabled={isStreaming || !input.trim()}
        >
          ↵
        </button>
      </div>
    </div>
  )
}