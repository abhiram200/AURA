import { useState, useEffect, useCallback, useMemo, useRef, memo, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { computeDiff, type DiffLine } from '../../utils/diffUtils'
type OrderedEvent =
  | { kind: 'write-tool'; tc: AuraToolCall; order: number }
  | { kind: 'ask-user'; tc: AuraToolCall; order: number }
  | { kind: 'other-tools'; tcs: AuraToolCall[]; order: number }
  | { kind: 'agents'; agents: AuraSubAgentInfo[]; order: number }
  | { kind: 'single-agent'; agent: AuraSubAgentInfo; order: number }

function buildOrderedEvents(toolCalls: AuraToolCall[], subAgents: AuraSubAgentInfo[]): OrderedEvent[] {
  const events: OrderedEvent[] = []

  // 1. Emit ask_user events individually, group remaining non-write tools at the top
  const askUserCalls = toolCalls.filter(tc => tc.name === 'ask_user')
  const otherTools = toolCalls.filter(tc => !WRITE_TOOLS.has(tc.name) && tc.name !== 'ask_user')
  for (const tc of askUserCalls) {
    events.push({ kind: 'ask-user', tc, order: tc.order ?? 0 })
  }
  if (otherTools.length > 0) {
    events.push({ kind: 'other-tools', tcs: otherTools, order: -1 })
  }

  // 2. Interleave write tools and sub-agents by call order
  const writeTools = toolCalls.filter(tc => WRITE_TOOLS.has(tc.name))
  const all: { type: 'write' | 'agent'; order: number; item: AuraToolCall | AuraSubAgentInfo }[] = [
    ...writeTools.map(tc => ({ type: 'write' as const, order: tc.order ?? 0, item: tc as AuraToolCall | AuraSubAgentInfo })),
    ...subAgents.map(sa => ({ type: 'agent' as const, order: sa.order ?? 0, item: sa as AuraToolCall | AuraSubAgentInfo })),
  ].sort((a, b) => a.order - b.order)

  // Group consecutive agents together
  let i = 0
  while (i < all.length) {
    const cur = all[i]
    if (cur.type === 'write') {
      events.push({ kind: 'write-tool', tc: cur.item as AuraToolCall, order: cur.order })
      i++
    } else {
      // Collect consecutive agents
      const group: AuraSubAgentInfo[] = [cur.item as AuraSubAgentInfo]
      let j = i + 1
      while (j < all.length && all[j].type === 'agent') {
        group.push(all[j].item as AuraSubAgentInfo)
        j++
      }
      if (group.length > 1) {
        events.push({ kind: 'agents', agents: group, order: cur.order })
      } else {
        events.push({ kind: 'single-agent', agent: group[0], order: cur.order })
      }
      i = j
    }
  }

  return events
}
import type { ManagedShellState } from '../../hooks/useManagedShells'
import { ShellBlock } from './ShellBlock'

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
  onActivity?: (type: 'edit' | 'interaction') => void
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
            {diffLines.adds > 0 && diffLines.removes > 0
              ? `added ${diffLines.adds} lines, removed ${diffLines.removes} lines`
              : diffLines.adds > 0
                ? `added ${diffLines.adds} line${diffLines.adds !== 1 ? 's' : ''}`
                : `removed ${diffLines.removes} line${diffLines.removes !== 1 ? 's' : ''}`}
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

const AskUserSection = memo(function AskUserSection({ tc }: { tc: AuraToolCall }) {
  const question = (tc.args as { question?: string }).question || ''
  const options = (tc.args as { options?: unknown }).options
  const res = tc.result as { answer?: string } | null
  const answer = res?.answer || (typeof tc.result === 'string' ? tc.result : null)
  return (
    <div className="aura-chat__ask-user">
      <div className="aura-chat__ask-user-question">
        <span className="aura-chat__ask-user-label">Question</span>
        <p>{question}</p>
        {Array.isArray(options) && options.length > 0 && (
          <div className="aura-chat__ask-user-options">
            {options.map((opt: string, idx: number) => (
              <span key={idx} className="aura-chat__ask-user-option">{opt}</span>
            ))}
          </div>
        )}
      </div>
      {answer && (
        <div className="aura-chat__ask-user-answer">
          <span className="aura-chat__ask-user-label">Answer</span>
          <p>{answer}</p>
        </div>
      )}
    </div>
  )
})

const SubAgentSection = memo(function SubAgentSection({ sa }: { sa: AuraSubAgentInfo }) {
  const statusClass = sa.status === 'completed' ? 'aura-chat__status-text--done'
    : sa.status === 'running' ? 'aura-chat__status-text--running'
    : 'aura-chat__status-text--error'
  const typeLabel = SUB_AGENT_TYPE_LABELS[sa.type || 'explore'] || 'Agent'
  const label = sa.title ? `${typeLabel}(${sa.title})` : `${typeLabel}(${sa.task.split('\n')[0].slice(0, 60)}…)`

  // Elapsed time for running agents
  const [elapsed, setElapsed] = useState<number>(0)
  useEffect(() => {
    if (sa.status !== 'running' || !sa.startTime) return
    const update = () => setElapsed(Math.round((Date.now() - sa.startTime!) / 1000))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [sa.status, sa.startTime])

  // Format tokens: >= 1000 → XK, else just the number
  const formatTokens = (tokens: number | undefined) => {
    if (tokens == null || tokens === 0) return ''
    if (tokens >= 1000) return `${Math.round(tokens / 1024 * 10) / 10}K`
    return String(tokens)
  }

  let meta = ''
  if (sa.status === 'running' && sa.startTime) {
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    meta = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  } else if (sa.status === 'completed' || sa.status === 'error') {
    const parts: string[] = []
    if (sa.toolsUsed != null && sa.toolsUsed > 0) parts.push(`${sa.toolsUsed} Tool${sa.toolsUsed !== 1 ? 's' : ''}`)
    const tokenStr = formatTokens(sa.tokensUsed)
    if (tokenStr) parts.push(`${tokenStr} tokens`)
    meta = parts.join(' · ')
  }

  return (
    <details className="aura-chat__sub-agent">
      <summary className="aura-chat__sub-agent-header">
        <StatusDot status={sa.status} />
        <span className={`aura-chat__sub-agent-task ${statusClass}`}>
          {label}{meta ? ` · ${meta}` : ''}
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
  // Format tokens for group display
  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) return `${Math.round(tokens / 1024 * 10) / 10}K`
    return String(tokens)
  }

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

  // Aggregate tools and tokens for completed agents
  const totalTools = subAgents.reduce((sum, sa) => sum + (sa.toolsUsed ?? 0), 0)
  const totalTokens = subAgents.reduce((sum, sa) => sum + (sa.tokensUsed ?? 0), 0)

  const parts: string[] = [`${subAgents.length} agents`]
  if (statusLabel) parts.push(statusLabel)
  if (running === 0 && totalTools > 0) {
    parts.push(`${totalTools} Tool${totalTools !== 1 ? 's' : ''}`)
    if (totalTokens > 0) parts.push(`${formatTokens(totalTokens)} tokens`)
  }

  const label = parts.join(' · ')
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

function MessageEvents({ toolCalls, subAgents }: { toolCalls: AuraToolCall[]; subAgents: AuraSubAgentInfo[] }) {
  const events = useMemo(() => buildOrderedEvents(toolCalls, subAgents), [toolCalls, subAgents])

  return (
    <div className="aura-chat__tool-calls">
      {events.map((evt, i) => {
        if (evt.kind === 'write-tool') {
          return <WriteToolSection key={`w-${i}`} tc={evt.tc} />
        }
        if (evt.kind === 'ask-user') {
          return <AskUserSection key={`au-${i}`} tc={evt.tc} />
        }
        if (evt.kind === 'other-tools') {
          return evt.tcs.length <= 1
            ? <ToolCallSection key={`t-${i}`} tc={evt.tcs[0]} />
            : <OtherToolCallsGroup key={`tg-${i}`} toolCalls={evt.tcs} />
        }
        if (evt.kind === 'agents') {
          return <SubAgentsGroup key={`ag-${i}`} subAgents={evt.agents} />
        }
        if (evt.kind === 'single-agent') {
          return <SubAgentSection key={`sa-${i}`} sa={evt.agent} />
        }
        return null
      })}
    </div>
  )
}

const ChatMessage = memo(function ChatMessage({ msg, onViewShell, liveShells }: { msg: AuraChatMessage; onViewShell?: (shellId: string) => void; liveShells?: Map<string, ManagedShellState> }) {
  const isUser = msg.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [msg.content])

  const hasSegments = !isUser && msg.segments && msg.segments.length > 0

  // Build grouped render blocks from segments
  type RenderBlock =
    | { kind: 'text'; content: string; key: string }
    | { kind: 'write-tool'; tc: AuraToolCall; key: string }
    | { kind: 'ask-user'; tc: AuraToolCall; key: string }
    | { kind: 'other-tool-group'; tcs: AuraToolCall[]; key: string }
    | { kind: 'agent-group'; agents: AuraSubAgentInfo[]; key: string }
    | { kind: 'single-agent'; agent: AuraSubAgentInfo; key: string }

  const renderBlocks: RenderBlock[] = useMemo(() => {
    if (!hasSegments || !msg.segments) return []
    const blocks: RenderBlock[] = []
    let i = 0
    while (i < msg.segments.length) {
      const seg = msg.segments[i]
      if (seg.type === 'text') {
        if (seg.content?.trim()) {
          blocks.push({ kind: 'text', content: seg.content, key: `txt-${i}` })
        }
        i++
      } else if (seg.type === 'tool_call' && seg.toolCall) {
        const tc = msg.toolCalls?.find(t => t.toolCallId === seg.toolCall!.toolCallId) || seg.toolCall
        if (WRITE_TOOLS.has(tc.name)) {
          blocks.push({ kind: 'write-tool', tc, key: `wt-${i}` })
          i++
        } else if (tc.name === 'ask_user') {
          blocks.push({ kind: 'ask-user', tc, key: `au-${i}` })
          i++
        } else {
          // Collect consecutive non-write, non-ask_user tool calls
          const group: AuraToolCall[] = [tc]
          let j = i + 1
          while (j < msg.segments.length && msg.segments[j].type === 'tool_call' && msg.segments[j].toolCall) {
            const nextTc = msg.toolCalls?.find(t => t.toolCallId === msg.segments[j].toolCall!.toolCallId) || msg.segments[j].toolCall
            if (WRITE_TOOLS.has(nextTc.name) || nextTc.name === 'ask_user') break
            group.push(nextTc)
            j++
          }
          blocks.push({ kind: 'other-tool-group', tcs: group, key: `tg-${i}` })
          i = j
        }
      } else if (seg.type === 'sub_agent_start' && seg.subAgent) {
        const sa = msg.subAgents?.find(s => s.taskId === seg.subAgent!.taskId) || seg.subAgent
        // Collect consecutive sub-agents
        const group: AuraSubAgentInfo[] = [sa]
        let j = i + 1
        while (j < msg.segments.length && msg.segments[j].type === 'sub_agent_start' && msg.segments[j].subAgent) {
          const nextSa = msg.subAgents?.find(s => s.taskId === msg.segments[j].subAgent!.taskId) || msg.segments[j].subAgent
          group.push(nextSa)
          j++
        }
        if (group.length > 1) {
          blocks.push({ kind: 'agent-group', agents: group, key: `ag-${i}` })
        } else {
          blocks.push({ kind: 'single-agent', agent: group[0], key: `sa-${i}` })
        }
        i = j
      } else {
        i++
      }
    }
    return blocks
  }, [hasSegments, msg.segments, msg.toolCalls, msg.subAgents])

  return (
    <div className={`aura-chat__message ${isUser ? 'aura-chat__message--user' : 'aura-chat__message--assistant'}`}>
      {hasSegments ? (
        // Segmented rendering: interleaved text, grouped tool calls, and agents
        renderBlocks.map((block) => {
          if (block.kind === 'text') {
            return (
              <div key={block.key} className="aura-chat__message-content">
                <ReactMarkdown remarkPlugins={RemarkPlugins} components={MarkdownComponents}>
                  {block.content}
                </ReactMarkdown>
              </div>
            )
          }
          if (block.kind === 'write-tool') {
            return <WriteToolSection key={block.key} tc={block.tc} />
          }
          if (block.kind === 'ask-user') {
            return <AskUserSection key={block.key} tc={block.tc} />
          }
          if (block.kind === 'other-tool-group') {
            return block.tcs.length === 1
              ? <ToolCallSection key={block.key} tc={block.tcs[0]} />
              : <OtherToolCallsGroup key={block.key} toolCalls={block.tcs} />
          }
          if (block.kind === 'agent-group') {
            return <SubAgentsGroup key={block.key} subAgents={block.agents} />
          }
          if (block.kind === 'single-agent') {
            return <SubAgentSection key={block.key} sa={block.agent} />
          }
          return null
        })
      ) : (
        // Legacy rendering for messages without segments
        <>
          {!isUser && (msg.toolCalls?.length || 0) + (msg.subAgents?.length || 0) > 0 && (
            <MessageEvents toolCalls={msg.toolCalls || []} subAgents={msg.subAgents || []} />
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
        </>
      )}
      {!isUser && msg.todos && msg.todos.length > 0 && (
        <TodoListSection todos={msg.todos} />
      )}
      {!isUser && msg.shells && msg.shells.length > 0 && (
        <ShellBlock shells={msg.shells} liveShells={liveShells} onViewShell={onViewShell} />
      )}
      {/* Show streaming cursor when content is empty during streaming (no segments yet) */}
      {!isUser && !hasSegments && msg.content === '' && (!msg.toolCalls || msg.toolCalls.length === 0) && (!msg.subAgents || msg.subAgents.length === 0) && (
        <span className="aura-chat__cursor" />
      )}
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
  // Compare segments
  const prevSegs = prev.msg.segments
  const nextSegs = next.msg.segments
  if (prevSegs?.length !== nextSegs?.length) return false
  if (prevSegs && nextSegs) {
    for (let i = 0; i < prevSegs.length; i++) {
      if (prevSegs[i].type !== nextSegs[i].type) return false
      if (prevSegs[i].content !== nextSegs[i].content) return false
      if (prevSegs[i].toolCall?.status !== nextSegs[i].toolCall?.status) return false
      if (prevSegs[i].toolCall?.result !== nextSegs[i].toolCall?.result) return false
      if (prevSegs[i].subAgent?.status !== nextSegs[i].subAgent?.status) return false
    }
  }
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
    const [customInput, setCustomInput] = useState('')
    const [showCustom, setShowCustom] = useState(false)
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
          {!showCustom ? (
            <button className="aura-chat__approval-btn aura-chat__approval-btn--edit" onClick={() => setShowCustom(true)}>Other</button>
          ) : (
            <div className="aura-chat__approval-custom">
              <input
                className="aura-chat__approval-custom-input"
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && customInput.trim()) onRespond(true, customInput.trim()) }}
                placeholder="Type your answer..."
                autoFocus
              />
              <button className="aura-chat__approval-btn aura-chat__approval-btn--approve" onClick={() => { if (customInput.trim()) onRespond(true, customInput.trim()) }} disabled={!customInput.trim()}>Send</button>
              <button className="aura-chat__approval-btn" onClick={() => { setShowCustom(false); setCustomInput('') }}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}

export default function AuraChat({ messages, isStreaming, error, onAsk, onClearError, pendingApproval, onRespondToApproval, onViewShell, liveShells, isActive, focusTrigger, onActivity }: AuraChatProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)

  // Auto-scroll: stick to bottom during streaming, stop if user scrolls up
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, pendingApproval])

  // Detect user scrolling up to break auto-scroll
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) return // scrolling down, stay stuck
      // User scrolled up — check if we're no longer at bottom
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
      if (!nearBottom) stickToBottomRef.current = false
    }

    const handleTouchMove = () => {
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
      if (!nearBottom) stickToBottomRef.current = false
    }

    // Keyboard: PageUp, Home, ArrowUp scroll up
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PageUp' || e.key === 'Home' || (e.key === 'ArrowUp' && !e.shiftKey)) {
        requestAnimationFrame(() => {
          const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
          if (!nearBottom) stickToBottomRef.current = false
        })
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Auto-focus input on mount, when tab becomes active, or after new chat
  useEffect(() => {
    if (isActive !== false) {
      inputRef.current?.focus()
    }
  }, [isActive, focusTrigger])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    stickToBottomRef.current = true
    onAsk(trimmed)
    onActivity?.('interaction')
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
    onActivity?.('interaction')
    const el = e.target
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [onActivity])

  return (
    <div className="aura-chat">
      <div className="aura-chat__messages" ref={messagesContainerRef}>
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
        {isStreaming && messages[messages.length - 1]?.role === 'assistant' && (messages[messages.length - 1]?.content !== '' || (messages[messages.length - 1]?.segments?.length || 0) > 0) && (
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