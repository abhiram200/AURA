import { useState, useEffect, useCallback, useMemo, useRef, memo, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AuraChatMessage, AuraToolCall, AuraSubAgentInfo, AuraTodoItem, AuraApprovalRequest } from '../../hooks/useAura'
import type { ManagedShellState } from '../../hooks/useManagedShells'
import { ShellBlock } from './ShellBlock'

interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const { lcs } = lcsMatrix(oldLines, newLines)
  const full = buildDiffLines(oldLines, newLines, lcs, 0, 0)
  return collapseToHunks(full, 5)
}

function collapseToHunks(lines: DiffLine[], context: number): DiffLine[] {
  // Find indices of all changed lines
  const changeIdxs: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'context') changeIdxs.push(i)
  }

  if (changeIdxs.length === 0) return []

  // Build ranges: each change gets `context` lines of surrounding context
  // Merge overlapping/adjacent ranges
  const ranges: [number, number][] = []
  for (const ci of changeIdxs) {
    const start = Math.max(0, ci - context)
    const end = Math.min(lines.length - 1, ci + context)
    if (ranges.length === 0 || start > ranges[ranges.length - 1][1] + 1) {
      ranges.push([start, end])
    } else {
      ranges[ranges.length - 1][1] = Math.max(ranges[ranges.length - 1][1], end)
    }
  }

  const result: DiffLine[] = []
  for (let r = 0; r < ranges.length; r++) {
    const [start, end] = ranges[r]
    if (r > 0) {
      result.push({ type: 'context', content: '⋯' })
    }
    for (let i = start; i <= end; i++) {
      result.push(lines[i])
    }
  }
  return result
}

function lcsMatrix(a: string[], b: string[]) {
  const m = a.length
  const n = b.length
  // For very large files, skip full LCS (O(n²) memory) and fall back to simple diff
  if (m > 2000 || n > 2000) {
    return { lcs: new Set<string>() }
  }

  let prev = new Uint16Array(n + 1)
  const dp: Uint16Array[] = [new Uint16Array(n + 1)]

  for (let i = 1; i <= m; i++) {
    const curr = new Uint16Array(n + 1)
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
    dp.push(new Uint16Array(curr))
    prev = curr
  }

  const lcsSet = new Set<string>()
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcsSet.add(`${i - 1},${j - 1}`)
      i--; j--
    } else if (dp[i - 1][j]! >= dp[i][j - 1]!) {
      i--
    } else {
      j--
    }
  }
  return { lcs: lcsSet }
}

function buildDiffLines(oldLines: string[], newLines: string[], lcs: Set<string>, startOld: number, startNew: number): DiffLine[] {
  const result: DiffLine[] = []
  let oi = 0, ni = 0
  const lcsPairs = Array.from(lcs).map(s => s.split(',').map(Number)).sort((a, b) => a[0] - b[0])

  for (const [oIdx, nIdx] of lcsPairs) {
    // Removed lines
    while (oi < oIdx) {
      result.push({ type: 'remove', content: oldLines[oi], oldLineNo: startOld + oi + 1 })
      oi++
    }
    // Added lines
    while (ni < nIdx) {
      result.push({ type: 'add', content: newLines[ni], newLineNo: startNew + ni + 1 })
      ni++
    }
    // Context line
    result.push({ type: 'context', content: oldLines[oi], oldLineNo: startOld + oi + 1, newLineNo: startNew + ni + 1 })
    oi++; ni++
  }
  // Remaining removed
  while (oi < oldLines.length) {
    result.push({ type: 'remove', content: oldLines[oi], oldLineNo: startOld + oi + 1 })
    oi++
  }
  // Remaining added
  while (ni < newLines.length) {
    result.push({ type: 'add', content: newLines[ni], newLineNo: startNew + ni + 1 })
    ni++
  }
  return result
}

const WRITE_TOOLS = new Set(['write', 'update'])

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

const WriteToolSection = memo(function WriteToolSection({ tc }: { tc: AuraToolCall }) {
  const statusClass = tc.status === 'completed' ? 'aura-chat__status-text--done'
    : tc.status === 'running' ? 'aura-chat__status-text--running'
    : 'aura-chat__status-text--error'

  const diffLines = useMemo(() => {
    if (tc.status !== 'completed' || !tc.result || typeof tc.result !== 'object') return null
    const res = tc.result as { filePath?: string; previousContent?: string | null; created?: boolean; replacements?: number; applied?: boolean }
    const filePath = res.filePath || (tc.args as Record<string, unknown>)?.filePath as string || ''
    const previousContent = res.previousContent
    if (previousContent == null && !res.created) return null

    // Get new content from args
    const newContent = (tc.args as Record<string, unknown>)?.content as string
      ?? (tc.args as Record<string, unknown>)?.newString as string
      ?? ''

    if (res.created) {
      // New file - show all lines as additions
      const lines = newContent.split('\n')
      return {
        filePath,
        created: true,
        lines: lines.map((line, i) => ({ type: 'add' as const, content: line, newLineNo: i + 1 })),
      }
    }

    // For update tool, reconstruct the full new content from old content + replacement
    let fullNewContent = newContent
    if (tc.name === 'update' && previousContent != null) {
      const oldString = (tc.args as Record<string, unknown>)?.oldString as string ?? ''
      const replaceAll = (tc.args as Record<string, unknown>)?.replaceAll as boolean ?? false
      const normalizedPrev = previousContent.replace(/\r\n/g, '\n')
      const normalizedOld = oldString.replace(/\r\n/g, '\n')
      const normalizedNew = newContent.replace(/\r\n/g, '\n')
      fullNewContent = replaceAll
        ? normalizedPrev.replaceAll(normalizedOld, normalizedNew)
        : normalizedPrev.replace(normalizedOld, normalizedNew)
    }

    const lines = computeDiff(previousContent.replace(/\r\n/g, '\n'), fullNewContent.replace(/\r\n/g, '\n'))
    const adds = lines.filter(l => l.type === 'add').length
    const removes = lines.filter(l => l.type === 'remove').length
    return { filePath, created: false, lines, adds, removes }
  }, [tc.status, tc.result, tc.args, tc.name])

  const label = tc.name === 'write'
    ? (diffLines?.created ? 'Created' : 'Modified')
    : 'Updated'

  return (
    <details className="aura-chat__write-tool" open>
      <summary className="aura-chat__write-tool-header">
        <StatusDot status={tc.status} />
        <span className={`aura-chat__write-tool-name ${statusClass}`}>
          {label} {diffLines?.filePath || ((tc.args as Record<string, unknown>)?.filePath as string) || ''}
        </span>
        {diffLines && !diffLines.created && (
          <span className="aura-chat__write-tool-stats">
            +{diffLines.adds} -{diffLines.removes}
          </span>
        )}
      </summary>
      {tc.status === 'completed' && diffLines && diffLines.lines.length > 0 && (
        <div className="aura-chat__write-tool-diff">
          {diffLines.lines.map((line, i) => (
            <div key={i} className={`aura-chat__diff-line aura-chat__diff-line--${line.type}`}>
              <span className="aura-chat__diff-line-no">
                {line.type === 'add' ? (line.newLineNo ?? '') : (line.oldLineNo ?? '')}
              </span>
              <span className="aura-chat__diff-line-no">
                {line.type === 'remove' ? '' : (line.newLineNo ?? '')}
              </span>
              <span className="aura-chat__diff-prefix">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              <span className="aura-chat__diff-content">{line.content}</span>
            </div>
          ))}
        </div>
      )}
      {tc.error && (
        <div className="aura-chat__tool-call-error">
          <span className="aura-chat__tool-call-label">Error:</span> {tc.error}
        </div>
      )}
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
  const writeCalls = toolCalls.filter(tc => WRITE_TOOLS.has(tc.name))
  const otherCalls = toolCalls.filter(tc => !WRITE_TOOLS.has(tc.name))

  return (
    <div className="aura-chat__tool-calls">
      {writeCalls.map((tc, i) => (
        <WriteToolSection key={`${tc.name}-${i}`} tc={tc} />
      ))}
      {otherCalls.length <= 1 ? (
        otherCalls.map((tc, i) => (
          <ToolCallSection key={`${tc.name}-${i}`} tc={tc} />
        ))
      ) : (
        <OtherToolCallsGroup toolCalls={otherCalls} />
      )}
    </div>
  )
}

function OtherToolCallsGroup({ toolCalls }: { toolCalls: AuraToolCall[] }) {
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