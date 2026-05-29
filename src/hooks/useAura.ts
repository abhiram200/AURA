import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { formatWriteUpdateDiff } from '../utils/diffUtils'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuraNodeData {
  id: string
  kind: string
  name: string
  filePath: string
  range?: { startLine: number; endLine: number }
  exported: boolean
}

export interface AuraEdgeData {
  source: string
  target: string
  type: string
  confidence: number
}

export interface AuraGraphData {
  nodes: AuraNodeData[]
  edges: AuraEdgeData[]
}

export interface AuraIndexingStatus {
  phase: string
  progress: number
  filesProcessed: number
  totalFiles: number
  nodesFound: number
  edgesFound: number
  message: string
  error?: string
}

export type AuraSearchMode = 'hybrid' | 'bm25' | 'basic'

export interface AuraSearchResult {
  node: AuraNodeData
  score: number
  mode?: AuraSearchMode
  bm25Score?: number
  semanticScore?: number
}

export interface AuraTraceStep {
  id: string
  name: string
  kind: string
  edgeType: string
  filePath?: string
}

export interface AuraSymbolImpact {
  id: string
  name: string
  kind: string
  score: number
  severity: 'critical' | 'moderate' | 'low'
  tracePath: AuraTraceStep[]
  range?: { startLine: number; endLine: number }
}

export interface AuraFileImpact {
  filePath: string
  severity: 'critical' | 'moderate' | 'low'
  score: number
  symbols: AuraSymbolImpact[]
}

export interface AuraDirectionResult {
  files: AuraFileImpact[]
  summary: {
    totalFiles: number
    critical: number
    moderate: number
    low: number
  }
}

export interface AuraImpactResult {
  target: string
  downstream: AuraDirectionResult
  upstream: AuraDirectionResult
}

export interface AuraNodeContext {
  node: AuraNodeData
  incoming: { node: AuraNodeData; edgeType: string }[]
  outgoing: { node: AuraNodeData; edgeType: string }[]
  members: AuraNodeData[]
  containedBy: AuraNodeData | null
  hierarchy: { node: AuraNodeData; relation: string }[]
}

export type AuraGitDiffScope = 'unstaged' | 'staged' | 'all' | 'compare'

export interface AuraHunkRange {
  startLine: number
  endLine: number
}

export interface AuraFileDiff {
  filePath: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  hunks: AuraHunkRange[]
  oldFilePath?: string
}

export interface AuraChangedSymbol {
  nodeId: string
  name: string
  kind: string
  filePath: string
  range?: { startLine: number; endLine: number }
  changeType: 'modified' | 'added' | 'deleted'
  hunks: AuraHunkRange[]
}

export interface AuraChangeDetectionResult {
  files: AuraFileDiff[]
  changedSymbols: AuraChangedSymbol[]
  impact: AuraImpactResult | null
  summary: {
    totalFiles: number
    totalSymbols: number
    criticalFiles: number
    moderateFiles: number
    lowFiles: number
  }
}

export type AuraRenameConfidence = 'graph' | 'text_search'

export interface AuraRenameEdit {
  filePath: string
  line: number
  column: number
  oldText: string
  newText: string
  confidence: AuraRenameConfidence
}

export interface AuraRenameResult {
  symbolId: string
  symbolName: string
  newName: string
  edits: AuraRenameEdit[]
  summary: {
    totalEdits: number
    graphEdits: number
    textSearchEdits: number
    filesAffected: number
  }
  dryRun: boolean
}

// ── API-Aware Tools types ────────────────────────────────────────────────────

export interface AuraRouteMiddleware {
  name: string
  filePath: string
  range?: { startLine: number; endLine: number }
}

export interface AuraResponseShapeField {
  key: string
  valueType: string
  source: 'response_literal' | 'return_type' | 'res_json' | 'inferred'
  confidence: number
}

export interface AuraShapeConsumer {
  nodeId: string
  name: string
  kind: string
  filePath: string
  accessedFields: string[]
  confidence: number
}

export interface AuraShapeMismatch {
  field: string
  accessedBy: string[]
  kind: 'missing_from_response' | 'type_mismatch' | 'possibly_null'
  description: string
}

export interface AuraRouteMapResult {
  routes: AuraNodeData[]
  apiCalls: AuraNodeData[]
  edges: AuraEdgeData[]
}

export interface AuraShapeCheckResult {
  routeId: string
  routePath: string
  routeMethod: string
  responseShape: AuraResponseShapeField[]
  consumers: AuraShapeConsumer[]
  mismatches: AuraShapeMismatch[]
  status: 'ok' | 'mismatch' | 'unknown'
}

export interface AuraApiImpactResult {
  routeId: string
  route: AuraNodeData
  consumers: { nodeId: string; name: string; kind: string; filePath: string; accessedFields: string[] }[]
  responseShape: AuraResponseShapeField[]
  shapeCheck: AuraShapeCheckResult | null
  downstreamImpact: AuraImpactResult | null
  middleware: AuraRouteMiddleware[]
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  riskFactors: string[]
}

// ── Process Tracing types ──────────────────────────────────────────────────

export interface AuraProcess {
  id: string
  name: string
  method: string
  path: string
  stepCount: number
  entryRouteId: string
}

export interface AuraProcessStep {
  order: number
  label: string
  nodeId: string
  name: string
  kind: string
}

export interface AuraProcessDetail {
  id: string
  name: string
  steps: AuraProcessStep[]
}

// ── Group types ──────────────────────────────────────────────────────────────

export interface AuraGroup {
  id: string
  name: string
  description: string
  memberProjectIds: string[]
  createdAt: string
  updatedAt: string
}

export interface AuraHttpContract {
  id: string
  providerProjectId: string
  method: string
  path: string
  pathPattern: string
  responseShape: AuraResponseShapeField[]
  consumerProjectId: string | null
  consumerNodeId: string | null
  sourceRouteNodeId: string | null
  matched: boolean
  matchConfidence: number
}

export interface AuraCrossProjectEdge {
  sourceProjectId: string
  sourceNodeId: string
  targetProjectId: string
  targetNodeId: string
  edgeType: string
  confidence: number
}

export interface AuraContractRegistry {
  groupId: string
  contracts: AuraHttpContract[]
  crossProjectEdges: AuraCrossProjectEdge[]
  syncedAt: string
  stats: {
    totalContracts: number
    matchedContracts: number
    unmatchedContracts: number
    crossProjectEdges: number
  }
}

export interface AuraGroupQueryResult {
  results: Array<{
    projectId: string
    projectName: string
    node: AuraNodeData
    score: number
    rank: number
  }>
  mergedScore: number
}

export interface AuraGroupImpactResult {
  target: { projectId: string; nodeId: string; nodeName: string; nodeKind: string }
  downstream: {
    withinProject: AuraImpactResult
    crossProject: Array<{
      targetProjectId: string
      sourceProjectId: string
      edge: AuraCrossProjectEdge
      downstream: AuraDirectionResult
    }>
  }
  upstream: {
    withinProject: AuraImpactResult
    crossProject: Array<{
      targetProjectId: string
      sourceProjectId: string
      edge: AuraCrossProjectEdge
      upstream: AuraDirectionResult
    }>
  }
}

export interface AuraGroupContextResult {
  target: { projectId: string; node: AuraNodeData }
  memberResults: Array<{
    projectId: string
    projectName: string
    context: AuraNodeContext | null
  }>
  crossProjectReferences: Array<{
    sourceProjectId: string
    sourceNodeId: string
    sourceNodeName: string
    targetProjectId: string
    targetNodeId: string
    edgeType: string
    confidence: number
  }>
}

export interface AuraGroupStatusResult {
  groupId: string
  groupName: string
  members: Array<{
    projectId: string
    projectName: string
    indexed: boolean
    lastIndexedAt: string | null
    nodeCount: number
    edgeCount: number
    stale: boolean
  }>
  contractRegistry: {
    synced: boolean
    syncedAt: string | null
    totalContracts: number
    matchedContracts: number
    stale: boolean
  }
}

// ── Chat / Agent types ─────────────────────────────────────────────────────────

export interface AuraRequestContext {
  selectedNode?: {
    id: string
    name: string
    kind: string
    filePath: string
    range?: { startLine: number; endLine: number }
  } | null
  selectedNodeContext?: {
    incoming: { id: string; name: string; kind: string; edgeType: string; filePath: string }[]
    outgoing: { id: string; name: string; kind: string; edgeType: string; filePath: string }[]
    members: { id: string; name: string; kind: string; filePath: string }[]
    hierarchy: { id: string; name: string; kind: string; relation: string }[]
    containedBy: { id: string; name: string; kind: string; filePath: string } | null
  } | null
  graphOverview: {
    nodeCount: number
    edgeCount: number
    nodeKinds: Record<string, number>
    edgeTypes: Record<string, number>
  }
  exploredContext?: {
    searchResults?: { id: string; name: string; kind: string; filePath: string; score: number }[]
    impactResult?: { target: string; downstream: { id: string; name: string; kind: string; filePath: string; severity: string }[]; upstream: { id: string; name: string; kind: string; filePath: string; severity: string }[] } | null
    changeDetection?: { filesChanged: number; changedSymbols: { id: string; name: string; kind: string; filePath: string }[] } | null
    routeMap?: { routeCount: number; apiCallCount: number; routes: { id: string; name: string; filePath: string }[] } | null
    processes?: { id: string; name: string; method: string; path: string }[] | null
  } | null
}

export interface AuraToolCall {
  name: string
  toolCallId?: string
  args: Record<string, unknown>
  result?: unknown
  error?: string
  status: 'running' | 'completed' | 'error'
  purpose?: string
  thinking?: string
  order?: number
}

export interface AuraSubAgentInfo {
  taskId: string
  title: string
  task: string
  type?: string
  status: 'running' | 'completed'
  result?: string
  order?: number
}

export interface AuraTodoItem {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy?: string[]
}

export interface AuraApprovalRequest {
  id: string
  type: 'command' | 'plan' | 'question'
  command?: string
  description?: string
  riskLevel?: 'high' | 'medium'
  cwd?: string
  planMarkdown?: string
  question?: string
  options?: string[]
}

export interface AuraShellEvent {
  shellId: string
  name: string
  command: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  exitCode: number | null
}

export interface MessageSegment {
  type: 'text' | 'tool_call' | 'sub_agent_start'
  content?: string
  toolCall?: AuraToolCall
  subAgent?: AuraSubAgentInfo
  order: number
}

export interface AuraChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AuraToolCall[]
  subAgents?: AuraSubAgentInfo[]
  todos?: AuraTodoItem[]
  shells?: AuraShellEvent[]
  segments?: MessageSegment[]
  timestamp: number
}

// ── Prior Messages Builder ────────────────────────────────────────────────────

const WRITE_UPDATE_TOOLS = new Set(['write', 'update'])
const CONTEXT_TOOLS = new Set(['write', 'update', 'ask_user'])

function getAssistantFullText(msg: AuraChatMessage): string {
  if (msg.role !== 'assistant' || !msg.segments || msg.segments.length === 0) return msg.content
  return msg.segments
    .filter(s => s.type === 'text' && s.content)
    .map(s => s.content!)
    .join('')
}

interface PriorMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: Record<string, unknown> } }>
  tool_call_id?: string
  name?: string
}

function buildPriorMessages(chatMessages: AuraChatMessage[]): PriorMessage[] {
  const result: PriorMessage[] = []

  for (const msg of chatMessages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
      continue
    }

    if (msg.role !== 'assistant') continue

    const fullText = getAssistantFullText(msg)
    const contextTCs = (msg.toolCalls || []).filter(tc => CONTEXT_TOOLS.has(tc.name))
    const subAgents = msg.subAgents || []
    const hasSubAgents = subAgents.length > 0

    // Include tool_calls for write/update, ask_user, and dispatch_sub_agents
    const toolCallsForMsg = []
    for (const tc of contextTCs) {
      toolCallsForMsg.push({
        id: tc.toolCallId || `${tc.name}_${tc.order ?? 0}`,
        function: { name: tc.name, arguments: tc.args },
      })
    }
    if (hasSubAgents) {
      // Find dispatch_sub_agents tool call if it exists
      const dispatchTC = (msg.toolCalls || []).find(tc => tc.name === 'dispatch_sub_agents')
      toolCallsForMsg.push({
        id: dispatchTC?.toolCallId || 'dispatch_sub_agents',
        function: { name: 'dispatch_sub_agents', arguments: {} },
      })
    }

    const entry: PriorMessage = { role: 'assistant', content: fullText }
    if (toolCallsForMsg.length > 0) {
      entry.tool_calls = toolCallsForMsg
    }
    result.push(entry)

    // Add tool results for context tools
    for (const tc of contextTCs) {
      if (WRITE_UPDATE_TOOLS.has(tc.name)) {
        const diffText = formatWriteUpdateDiff(tc as { name: string; args: Record<string, unknown>; result: unknown })
        result.push({
          role: 'tool',
          content: diffText || JSON.stringify({ filePath: (tc.args as Record<string, unknown>)?.filePath || '', applied: true }),
          tool_call_id: tc.toolCallId || `${tc.name}_${tc.order ?? 0}`,
          name: tc.name,
        })
      } else {
        // ask_user — format as readable Q&A
        let resultContent: string
        const res = tc.result as { question?: string; answer?: string } | null
        if (res?.question && res?.answer) {
          resultContent = `Q: ${res.question}\nA: ${res.answer}`
        } else {
          resultContent = tc.result != null
            ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result))
            : (tc.error || 'No result')
        }
        result.push({
          role: 'tool',
          content: resultContent,
          tool_call_id: tc.toolCallId || `${tc.name}_${tc.order ?? 0}`,
          name: tc.name,
        })
      }
    }

    // Add sub-agent combined result
    if (hasSubAgents) {
      const dispatchTC = (msg.toolCalls || []).find(tc => tc.name === 'dispatch_sub_agents')
      const completedSAs = subAgents.filter(sa => sa.status === 'completed')
      let subText = '## Sub-Agent Research Results\n\n'
      for (const sa of completedSAs) {
        subText += `### ${sa.title}\n${sa.result || 'No result'}\n\n---\n\n`
      }
      if (completedSAs.length === 0) {
        subText = 'Sub-agents still running or no results available.'
      }
      result.push({
        role: 'tool',
        content: subText,
        tool_call_id: dispatchTC?.toolCallId || 'dispatch_sub_agents',
        name: 'dispatch_sub_agents',
      })
    }
  }

  return result
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAura(projectId: string | null) {
  const [graphData, setGraphData] = useState<AuraGraphData | null>(null)
  const [indexingStatus, setIndexingStatus] = useState<AuraIndexingStatus | null>(null)
  const [selectedNode, setSelectedNode] = useState<AuraNodeData | null>(null)
  const [nodeContext, setNodeContext] = useState<AuraNodeContext | null>(null)
  const [impactResult, setImpactResult] = useState<AuraImpactResult | null>(null)
  const [searchResults, setSearchResults] = useState<AuraSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changeDetectionResult, setChangeDetectionResult] = useState<AuraChangeDetectionResult | null>(null)
  const [renameResult, setRenameResult] = useState<AuraRenameResult | null>(null)
  const [routeMapResult, setRouteMapResult] = useState<AuraRouteMapResult | null>(null)
  const [shapeCheckResult, setShapeCheckResult] = useState<AuraShapeCheckResult | null>(null)
  const [apiImpactResult, setApiImpactResult] = useState<AuraApiImpactResult | null>(null)
  const [processes, setProcesses] = useState<AuraProcess[]>([])
  const [processDetail, setProcessDetail] = useState<AuraProcessDetail | null>(null)
  const [chatMessages, setChatMessages] = useState<AuraChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [offline, setOffline] = useState<'backend' | 'ollama' | null>(null)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<AuraApprovalRequest | null>(null)

  const chatMessagesRef = useRef<AuraChatMessage[]>(chatMessages)
  const activeChatIdRef = useRef<string | null>(activeChatId)
  chatMessagesRef.current = chatMessages
  activeChatIdRef.current = activeChatId

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const editsSinceLastIndexRef = useRef(false)
  const lastActivityRef = useRef(Date.now())
  const gitHeadRef = useRef<string | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingGitCommitRef = useRef<Set<string>>(new Set()) // tool_call_ids of git commit attempts
  const pendingRetryRef = useRef<{ assistantId: string; prompt: string } | null>(null) // retry after indexing

  // ── Helpers ──────────────────────────────────────────────────────────────

  const clearAllPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  const resetState = useCallback(() => {
    setGraphData(null)
    setIndexingStatus(null)
    setSelectedNode(null)
    setNodeContext(null)
    setImpactResult(null)
    setSearchResults([])
    setLoading(false)
    setError(null)
  }, [])

  // ── Activity Tracking & Idle Re-index ─────────────────────────────────────

  const reportActivity = useCallback((type: 'edit' | 'interaction' = 'interaction') => {
    lastActivityRef.current = Date.now()
    if (type === 'edit') {
      editsSinceLastIndexRef.current = true
    }
  }, [])

  // ── Chat Persistence ─────────────────────────────────────────────────────────

  // ── Chat Persistence ─────────────────────────────────────────────────────────

  const saveChat = useCallback(async () => {
    const pid = projectId
    const cid = activeChatIdRef.current
    const msgs = chatMessagesRef.current
    if (!pid || !cid) return
    try {
      await fetch(`/api/aura/chats/${pid}/${cid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs }),
      })
    } catch {
      // Save failed silently
    }
  }, [projectId])

  const startNewChat = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/aura/chats/${projectId}`, { method: 'POST' })
      if (res.ok) {
        const newChat = await res.json()
        setActiveChatId(newChat.id)
        setChatMessages([])
        setChatError(null)
      }
    } catch {
      // Create failed silently
    }
  }, [projectId])

  const loadActiveChat = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`/api/aura/chats/${pid}`)
      if (res.ok) {
        const chat = await res.json()
        if (chat) {
          setActiveChatId(chat.id)
          setChatMessages(chat.messages || [])
          return
        }
      }
      // No chat — create one
      const createRes = await fetch(`/api/aura/chats/${pid}`, { method: 'POST' })
      if (createRes.ok) {
        const newChat = await createRes.json()
        setActiveChatId(newChat.id)
        setChatMessages([])
      }
    } catch {
      // Load failed
    }
  }, [])

  // ── Indexing ─────────────────────────────────────────────────────────────

  const startIndexing = useCallback(async (pid: string) => {
    setLoading(true)
    setError(null)
    editsSinceLastIndexRef.current = false
    // Refresh git HEAD after re-index
    ;(async () => {
      try {
        const res = await fetch(`/api/workspace/${pid}/git-head`)
        if (res.ok) {
          const data = await res.json()
          gitHeadRef.current = data.head
        }
      } catch { /* ignore */ }
    })()
    try {
      const res = await fetch(`/api/aura/index/${pid}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Indexing failed (${res.status})`)
      }
      // Start polling for status
      clearAllPolling()
      pollIntervalRef.current = setInterval(() => {
        void (async () => {
          try {
            const statusRes = await fetch(`/api/aura/status/${pid}`)
            if (!statusRes.ok) return
            const status: AuraIndexingStatus = await statusRes.json()
            setIndexingStatus(status)

            if (status.phase === 'complete' || status.phase === 'watching') {
              clearAllPolling()
              // Fetch the completed graph
              const graphRes = await fetch(`/api/aura/graph/${pid}`)
              if (graphRes.ok) {
                const graph: AuraGraphData = await graphRes.json()
                setGraphData(graph)
              }
              setLoading(false)
              // Retry pending ask if one was queued
              const pending = pendingRetryRef.current
              if (pending) {
                pendingRetryRef.current = null
                retryAskRef.current(pending.assistantId, pending.prompt)
              }
            } else if (status.phase === 'error') {
              clearAllPolling()
              setError(status.error || 'Indexing failed')
              setLoading(false)
              // Clear pending retry if indexing failed
              pendingRetryRef.current = null
            }
          } catch {
            // Polling error — don't crash, just skip
          }
        })()
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start indexing')
      setLoading(false)
    }
  }, [clearAllPolling])

  // ── Search ───────────────────────────────────────────────────────────────

  const search = useCallback(async (query: string, options?: { limit?: number; kinds?: string[]; mode?: AuraSearchMode }) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const body: { query: string; limit?: number; kinds?: string[]; mode?: string } = { query }
      if (options?.limit !== undefined) body.limit = options.limit
      if (options?.kinds && options.kinds.length > 0) body.kinds = options.kinds
      if (options?.mode) body.mode = options.mode
      const res = await fetch(`/api/aura/search/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Search failed (${res.status})`)
      }
      const data = await res.json()
      setSearchResults(data.results ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Select Node ──────────────────────────────────────────────────────────

  const selectNode = useCallback(async (node: AuraNodeData | null) => {
    setSelectedNode(node)
    setNodeContext(null)
    setImpactResult(null)

    if (!node || !projectId) return

    setLoading(true)
    setError(null)
    try {
      // Fetch context and impact in parallel
      const [contextRes, impactRes] = await Promise.all([
        fetch(`/api/aura/context/${projectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: node.id }),
        }),
        fetch(`/api/aura/impact/${projectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId: node.id }),
        }),
      ])

      if (contextRes.ok) {
        const ctx: AuraNodeContext = await contextRes.json()
        setNodeContext(ctx)
      }
      if (impactRes.ok) {
        const impact: AuraImpactResult = await impactRes.json()
        setImpactResult(impact)
      }

      if (!contextRes.ok && !impactRes.ok) {
        const errBody = await contextRes.json().catch(() => ({}))
        throw new Error(errBody.error || 'Failed to load node details')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load node details')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Fetch Impact ─────────────────────────────────────────────────────────

  const fetchImpact = useCallback(async (targetId: string) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/impact/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Impact analysis failed (${res.status})`)
      }
      const impact: AuraImpactResult = await res.json()
      setImpactResult(impact)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impact analysis failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Detect Changes ──────────────────────────────────────────────────────

  const detectChanges = useCallback(async (scope: AuraGitDiffScope = 'unstaged', options?: { base?: string; head?: string }) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, string> = { scope }
      if (options?.base) body.base = options.base
      if (options?.head) body.head = options.head
      const res = await fetch(`/api/aura/detect-changes/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Detect changes failed (${res.status})`)
      }
      const result: AuraChangeDetectionResult = await res.json()
      setChangeDetectionResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detect changes failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Rename ──────────────────────────────────────────────────────────────

  const rename = useCallback(async (nodeId: string, newName: string, dryRun: boolean = true) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/rename/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, newName, dryRun }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Rename failed (${res.status})`)
      }
      const result: AuraRenameResult = await res.json()
      setRenameResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Fetch Route Map ──────────────────────────────────────────────────────

  const fetchRouteMap = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/route-map/${projectId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Route map failed (${res.status})`)
      }
      const result: AuraRouteMapResult = await res.json()
      setRouteMapResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Route map failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Fetch Shape Check ────────────────────────────────────────────────────

  const fetchShapeCheck = useCallback(async (routeId: string) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/shape-check/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Shape check failed (${res.status})`)
      }
      const result: AuraShapeCheckResult = await res.json()
      setShapeCheckResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shape check failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Fetch API Impact ─────────────────────────────────────────────────────

  const fetchApiImpact = useCallback(async (routeId: string) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/api-impact/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `API impact failed (${res.status})`)
      }
      const result: AuraApiImpactResult = await res.json()
      setApiImpactResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'API impact failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Fetch Processes ───────────────────────────────────────────────────────

  const fetchProcesses = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/processes/${projectId}`)
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Processes fetch failed (${res.status})`)
      }
      const data = await res.json()
      setProcesses(data.processes ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processes fetch failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchProcessDetail = useCallback(async (processId: string) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/process/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processId }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Process detail fetch failed (${res.status})`)
      }
      const detail: AuraProcessDetail = await res.json()
      setProcessDetail(detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Process detail fetch failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // ── Auto-load on projectId change (smart: only re-index if changes detected) ──

  useEffect(() => {
    if (!projectId) {
      resetState()
      clearAllPolling()
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Check if already indexing
        const statusRes = await fetch(`/api/aura/status/${projectId}`)
        if (cancelled) return

        if (statusRes.ok) {
          const status: AuraIndexingStatus = await statusRes.json()
          if (cancelled) return
          setIndexingStatus(status)

          const activePhases = ['indexing', 'processing', 'scanning', 'parsing', 'resolving', 'typeResolving', 'aggregating', 'saving', 'apiAnalysis', 'processTracing', 'searchIndexing']
          if (activePhases.includes(status.phase)) {
            // Already indexing — start polling until done
            clearAllPolling()
            pollIntervalRef.current = setInterval(() => {
              void (async () => {
                try {
                  const pollRes = await fetch(`/api/aura/status/${projectId}`)
                  if (!pollRes.ok) return
                  const pollStatus: AuraIndexingStatus = await pollRes.json()
                  setIndexingStatus(pollStatus)

                  if (pollStatus.phase === 'complete' || pollStatus.phase === 'watching') {
                    clearAllPolling()
                    const gRes = await fetch(`/api/aura/graph/${projectId}`)
                    if (gRes.ok) {
                      const g: AuraGraphData = await gRes.json()
                      setGraphData(g)
                    }
                    setLoading(false)
                  } else if (pollStatus.phase === 'error') {
                    clearAllPolling()
                    setError(pollStatus.error || 'Indexing failed')
                    setLoading(false)
                  }
                } catch {
                  // skip
                }
              })()
            }, 1000)
            return
          }
        }

        // Smart re-index: check if changes exist before re-indexing
        const needsRes = await fetch(`/api/aura/needs-reindex/${projectId}`)
        if (cancelled) return

        if (needsRes.ok) {
          const needsData = await needsRes.json()
          if (!needsData.needsReindex) {
            // No changes — just load the existing graph
            const graphRes = await fetch(`/api/aura/graph/${projectId}`)
            if (cancelled) return
            if (graphRes.ok) {
              const graph: AuraGraphData = await graphRes.json()
              setGraphData(graph)
              setIndexingStatus({ phase: 'complete', progress: 100, filesProcessed: 0, totalFiles: 0, nodesFound: 0, edgesFound: 0, message: 'Loaded from cache' })
            }
            setLoading(false)
            return
          }
        }

        // Changes detected or first time — full re-index
        await startIndexing(projectId!)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load AURA data')
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      clearAllPolling()
    }
  }, [projectId, clearAllPolling, resetState, startIndexing])

  // ── Idle Re-index Timer (5 min) ────────────────────────────────────────────

  useEffect(() => {
    if (!projectId) return

    // Capture initial git HEAD for change detection
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/workspace/${projectId}/git-head`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          gitHeadRef.current = data.head
        }
      } catch { /* ignore */ }
    })()

    // Check every 30s: if idle for 5+ min and edits since last index, re-index
    const IDLE_MS = 5 * 60 * 1000
    const CHECK_MS = 30 * 1000

    idleTimerRef.current = setInterval(() => {
      if (!projectId) return
      const idle = Date.now() - lastActivityRef.current
      if (idle < IDLE_MS) return

      // Check git HEAD change (catches manual terminal commits)
      ;(async () => {
        let gitChanged = false
        try {
          const res = await fetch(`/api/workspace/${projectId}/git-head`)
          if (res.ok) {
            const data = await res.json()
            if (gitHeadRef.current && data.head !== gitHeadRef.current) {
              // HEAD changed — check if files actually changed (skip merge-only commits)
              const changesRes = await fetch(`/api/workspace/${projectId}/has-file-changes?oldHead=${encodeURIComponent(gitHeadRef.current)}&newHead=${encodeURIComponent(data.head)}`)
              if (changesRes.ok) {
                const changesData = await changesRes.json()
                gitChanged = changesData.hasChanges
              } else {
                gitChanged = true // assume changes on error
              }
            }
            gitHeadRef.current = data.head
          }
        } catch { /* ignore */ }

        if (editsSinceLastIndexRef.current || gitChanged) {
          editsSinceLastIndexRef.current = false
          startIndexing(projectId)
        }
      })()
    }, CHECK_MS)

    return () => {
      cancelled = true
      if (idleTimerRef.current !== null) {
        clearInterval(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [projectId, startIndexing])

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearAllPolling()
      if (idleTimerRef.current !== null) {
        clearInterval(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [clearAllPolling])

  // ── Load active chat on mount ───────────────────────────────────────────

  useEffect(() => {
    if (!projectId) {
      setChatMessages([])
      setActiveChatId(null)
      return
    }
    loadActiveChat(projectId)
  }, [projectId, loadActiveChat])

  // ── Ask (AI Agent) ──────────────────────────────────────────────────────────

  const ask = useCallback(async (prompt: string, onShellEvent?: (eventType: string, data: Record<string, unknown>) => void) => {
    if (!projectId) return

    const userMsg: AuraChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }
    setChatMessages(prev => [...prev, userMsg])
    setIsStreaming(true)
    setChatError(null)

    const assistantId = crypto.randomUUID()
    const assistantMsg: AuraChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      subAgents: [],
      timestamp: Date.now(),
    }
    setChatMessages(prev => [...prev, assistantMsg])

    // Build context from current graph state (only sent from UI)
    const nodeKinds: Record<string, number> = {}
    const edgeTypes: Record<string, number> = {}
    if (graphData) {
      for (const n of graphData.nodes) nodeKinds[n.kind] = (nodeKinds[n.kind] || 0) + 1
      for (const e of graphData.edges) edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1
    }
    // Build explored context from already-available frontend state
    const hasExplored = searchResults.length > 0 || impactResult || changeDetectionResult || routeMapResult || (processes && processes.length > 0)
    const exploredContext: AuraRequestContext['exploredContext'] = hasExplored ? {} : null
    if (exploredContext) {
      if (searchResults.length > 0) {
        exploredContext.searchResults = searchResults.slice(0, 20).map(r => ({ id: r.node.id, name: r.node.name, kind: r.node.kind, filePath: r.node.filePath, score: r.score }))
      }
      if (impactResult) {
        exploredContext.impactResult = {
          target: impactResult.target,
          downstream: impactResult.downstream.nodes.slice(0, 15).map(n => ({ id: n.node.id, name: n.node.name, kind: n.node.kind, filePath: n.node.filePath, severity: n.severity })),
          upstream: impactResult.upstream.nodes.slice(0, 15).map(n => ({ id: n.node.id, name: n.node.name, kind: n.node.kind, filePath: n.node.filePath, severity: n.severity })),
        }
      }
      if (changeDetectionResult) {
        exploredContext.changeDetection = {
          filesChanged: changeDetectionResult.files.length,
          changedSymbols: changeDetectionResult.changedSymbols.slice(0, 20).map(s => ({ id: s.node.id, name: s.node.name, kind: s.node.kind, filePath: s.node.filePath })),
        }
      }
      if (routeMapResult) {
        exploredContext.routeMap = {
          routeCount: routeMapResult.routes.length,
          apiCallCount: routeMapResult.apiCalls.length,
          routes: routeMapResult.routes.slice(0, 20).map(r => ({ id: r.id, name: r.name, filePath: r.filePath })),
        }
      }
      if (processes && processes.length > 0) {
        exploredContext.processes = processes.slice(0, 10).map(p => ({ id: p.id, name: p.name, method: p.method, path: p.path }))
      }
    }
    const context: AuraRequestContext = {
      selectedNode: selectedNode ? { id: selectedNode.id, name: selectedNode.name, kind: selectedNode.kind, filePath: selectedNode.filePath, range: selectedNode.range } : null,
      selectedNodeContext: nodeContext ? {
        incoming: nodeContext.incoming.map(i => ({ id: i.node.id, name: i.node.name, kind: i.node.kind, edgeType: i.edgeType, filePath: i.node.filePath })),
        outgoing: nodeContext.outgoing.map(o => ({ id: o.node.id, name: o.node.name, kind: o.node.kind, edgeType: o.edgeType, filePath: o.node.filePath })),
        members: nodeContext.members.map(m => ({ id: m.id, name: m.name, kind: m.kind, filePath: m.filePath })),
        hierarchy: nodeContext.hierarchy.map(h => ({ id: h.node.id, name: h.node.name, kind: h.node.kind, relation: h.relation })),
        containedBy: nodeContext.containedBy ? { id: nodeContext.containedBy.id, name: nodeContext.containedBy.name, kind: nodeContext.containedBy.kind, filePath: nodeContext.containedBy.filePath } : null,
      } : null,
      graphOverview: {
        nodeCount: graphData?.nodes.length ?? 0,
        edgeCount: graphData?.edges.length ?? 0,
        nodeKinds,
        edgeTypes,
      },
      exploredContext,
    }

    try {
      // Send prior messages so the agent has conversation memory
      const priorMessages = buildPriorMessages(chatMessages)

      const res = await fetch(`/api/aura/ask/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context, priorMessages }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        // Auto-retry: if graph not available, trigger re-index and retry after completion
        if (res.status === 503 && errBody.needsReindex && projectId) {
          setChatMessages(prev => {
            const updated = [...prev]
            const idx = updated.findIndex(m => m.id === assistantId)
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], content: 'Re-indexing project... your message will be sent once ready.' }
            }
            return updated
          })
          pendingRetryRef.current = { assistantId, prompt }
          startIndexing(projectId)
          return
        }
        throw new Error(errBody.error || `Ask failed (${res.status})`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      let eventOrder = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim()
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.substring(6))
              const eventType = currentEvent // capture before React defers the updater

              // Handle context_usage outside the messages updater
              if (eventType === 'context_usage') {
                if (data.systemTokens) setSystemPromptTokens(data.systemTokens as number)
                if (data.contextWindow) setContextWindowSize(data.contextWindow as number)
                currentEvent = ''
                continue
              }

              setChatMessages(prev => {
                const updated = [...prev]
                const idx = updated.findIndex(m => m.id === assistantId)
                if (idx === -1) return prev
                const msg = { ...updated[idx] }

                if (eventType === 'token') {
                  msg.content += data.content || ''
                  // Create new array to avoid mutating previous state (StrictMode double-invokes updaters)
                  const segments = [...(msg.segments || [])]
                  if (segments.length > 0 && segments[segments.length - 1].type === 'text') {
                    segments[segments.length - 1] = { ...segments[segments.length - 1], content: msg.content }
                  } else {
                    segments.push({ type: 'text', content: msg.content, order: eventOrder++ })
                  }
                  msg.segments = segments
                } else if (eventType === 'tool_call') {
                  // Save any accumulated text as a segment, then add tool_call segment
                  const segments = [...(msg.segments || [])]
                  if (msg.content.trim()) {
                    // If last segment is text, just keep it; otherwise add new text segment
                    if (segments.length === 0 || segments[segments.length - 1].type !== 'text') {
                      segments.push({ type: 'text', content: msg.content, order: eventOrder++ })
                    }
                  }
                  const newTc: AuraToolCall = {
                    name: data.name,
                    toolCallId: data.tool_call_id,
                    args: data.args || {},
                    status: 'running' as const,
                    order: eventOrder++,
                  }
                  // Track edit activity from file-modifying tools
                  const editTools = ['write', 'update', 'execute', 'git']
                  if (editTools.includes(data.name)) {
                    reportActivity('edit')
                  }
                  // Track git commit attempts to trigger re-index on success
                  if (data.name === 'git') {
                    const gitArgs = typeof (data.args as Record<string, unknown>)?.args === 'string'
                      ? (data.args as Record<string, unknown>).args as string
                      : ''
                    // Detect commit as first subcommand OR chained via && / ;
                    // e.g. "commit -m ..." or "add -A && git commit -m ..."
                    const hasCommit = gitArgs.split(/\s+/)[0] === 'commit'
                      || /(?:&&|;)\s*git\s+commit\b/.test(gitArgs)
                    if (hasCommit) {
                      pendingGitCommitRef.current.add(data.tool_call_id || `${data.name}_${eventOrder}`)
                    }
                  }
                  msg.toolCalls = [...(msg.toolCalls || []), newTc]
                  msg.content = '' // Reset content — text before this tool is now in segments
                  segments.push({ type: 'tool_call', toolCall: newTc, order: newTc.order! })
                  msg.segments = segments
                } else if (eventType === 'tool_result') {
                  const tcId = data.tool_call_id
                  const matchedName = data.name as string | undefined
                  // Match by ID (preferred) or by name+status (fallback)
                  const matchRunningFn = (tc: AuraToolCall) =>
                    tcId ? tc.toolCallId === tcId : (matchedName != null && tc.name === matchedName && tc.status === 'running')
                  const matchAnyFn = (tc: AuraToolCall) =>
                    tcId ? tc.toolCallId === tcId : (matchedName != null && tc.name === matchedName)

                  const updatedToolCalls = (msg.toolCalls || []).map((tc: AuraToolCall) =>
                    matchRunningFn(tc) ? { ...tc, result: data.result, error: data.error, status: data.error ? 'error' as const : 'completed' as const } : tc
                  )
                  msg.toolCalls = updatedToolCalls

                  // Find the updated tool call to also update segments
                  const updatedTc = updatedToolCalls.find(matchAnyFn)
                  if (updatedTc) {
                    const segMatchFn = (s: MessageSegment) =>
                      s.type === 'tool_call' && s.toolCall != null && matchAnyFn(s.toolCall)
                    msg.segments = (msg.segments || []).map(s =>
                      segMatchFn(s) ? { ...s, toolCall: updatedTc } : s
                    )
                  }
                  // Detect successful git commit — trigger immediate re-index
                  if (data.name === 'git' && tcId && pendingGitCommitRef.current.has(tcId)) {
                    pendingGitCommitRef.current.delete(tcId)
                    const result = data.result as Record<string, unknown> | undefined
                    if (!data.error && result?.exitCode === 0) {
                      if (projectId) {
                        startIndexing(projectId)
                      }
                    }
                  }
                } else if (eventType === 'sub_agent_start') {
                  const newSa: AuraSubAgentInfo = {
                    taskId: data.taskId,
                    title: data.title || '',
                    task: data.task,
                    type: data.type || 'explore',
                    status: 'running' as const,
                    order: eventOrder++,
                  }
                  msg.subAgents = [...(msg.subAgents || []), newSa]
                  // Create new array to avoid mutating previous state (StrictMode double-invokes updaters)
                  const segments = [...(msg.segments || [])]
                  if (msg.content.trim()) {
                    if (segments.length === 0 || segments[segments.length - 1].type !== 'text') {
                      segments.push({ type: 'text', content: msg.content, order: eventOrder++ })
                    }
                  }
                  msg.content = ''
                  segments.push({ type: 'sub_agent_start', subAgent: newSa, order: newSa.order! })
                  msg.segments = segments
                } else if (eventType === 'sub_agent_result') {
                  msg.subAgents = (msg.subAgents || []).map((sa: AuraSubAgentInfo) =>
                    sa.taskId === data.taskId
                      ? { ...sa, result: data.result, status: 'completed' as const }
                      : sa
                  )
                  // Update segment too
                  const saSegments = msg.segments || []
                  msg.segments = saSegments.map(s =>
                    s.type === 'sub_agent_start' && s.subAgent?.taskId === data.taskId
                      ? { ...s, subAgent: { ...s.subAgent!, result: data.result, status: 'completed' as const } }
                      : s
                  )
                } else if (eventType === 'todo_update') {
                  msg.todos = data.todos || []
                } else if (eventType === 'approval_request') {
                  setPendingApproval(data as AuraApprovalRequest)
                } else if (eventType === 'shell_spawned') {
                  msg.shells = [...(msg.shells || []), {
                    shellId: data.shellId,
                    name: data.name,
                    command: data.command,
                    status: 'running' as const,
                    exitCode: null,
                  }]
                  if (onShellEvent) onShellEvent('shell_spawned', data)
                } else if (eventType === 'shell_exited') {
                  msg.shells = (msg.shells || []).map((s: AuraShellEvent) =>
                    s.shellId === data.shellId
                      ? { ...s, status: data.exitCode === 0 ? 'completed' as const : 'failed' as const, exitCode: data.exitCode as number }
                      : s
                  )
                  if (onShellEvent) onShellEvent('shell_exited', data)
                } else if (eventType === 'shell_terminated') {
                  msg.shells = (msg.shells || []).map((s: AuraShellEvent) =>
                    s.shellId === data.shellId
                      ? { ...s, status: 'killed' as const, exitCode: -1 }
                      : s
                  )
                  if (onShellEvent) onShellEvent('shell_terminated', data)
                } else if (eventType === 'shell_output') {
                  if (onShellEvent) onShellEvent('shell_output', data)
                } else if (eventType === 'error') {
                  const errMsg = typeof data.message === 'string' ? data.message : String(data.message)
                  // Parse 429 rate limit errors for cleaner display
                  if (errMsg.includes('429')) {
                    const jsonMatch = errMsg.match(/429\s*(\{.*\})/s)
                    let rateMsg = errMsg
                    if (jsonMatch) {
                      try {
                        const parsed = JSON.parse(jsonMatch[1])
                        if (parsed.error) rateMsg = parsed.error
                      } catch { /* use raw */ }
                    }
                    msg.content += `\n\n⚠️ ${rateMsg}`
                  } else {
                    msg.content += `\n\n⚠️ Error: ${errMsg}`
                  }
                }

                updated[idx] = msg
                return updated
              })

              currentEvent = ''
            } catch {
              // Skip malformed data
            }
          }
        }
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Ask failed')
      setChatMessages(prev => {
        const updated = [...prev]
        const idx = updated.findIndex(m => m.id === assistantId)
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], content: updated[idx].content || `Error: ${err instanceof Error ? err.message : 'Ask failed'}` }
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
      saveChat()
    }
  }, [projectId, graphData, selectedNode, nodeContext, chatMessages, saveChat])

  const askRef = useRef(ask)
  askRef.current = ask

  // Retry a failed message into an existing assistant slot (used after re-indexing)
  const retryAsk = useCallback(async (assistantId: string, prompt: string) => {
    if (!projectId) return
    setIsStreaming(true)
    setChatError(null)

    // Clear the "Re-indexing..." message and reset the assistant message for streaming
    setChatMessages(prev => {
      const updated = [...prev]
      const idx = updated.findIndex(m => m.id === assistantId)
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], content: '', toolCalls: [], subAgents: [], segments: [] }
      }
      return updated
    })

    // Build context (same as ask())
    const nodeKinds: Record<string, number> = {}
    const edgeTypes: Record<string, number> = {}
    if (graphData) {
      for (const n of graphData.nodes) nodeKinds[n.kind] = (nodeKinds[n.kind] || 0) + 1
      for (const e of graphData.edges) edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1
    }
    const hasExplored = searchResults.length > 0 || impactResult || changeDetectionResult || routeMapResult || (processes && processes.length > 0)
    const exploredContext: AuraRequestContext['exploredContext'] = hasExplored ? {} : null
    if (exploredContext) {
      if (searchResults.length > 0) exploredContext.searchResults = searchResults.slice(0, 20).map(r => ({ id: r.node.id, name: r.node.name, kind: r.node.kind, filePath: r.node.filePath, score: r.score }))
      if (impactResult) exploredContext.impactResult = { target: impactResult.target, downstream: impactResult.downstream.nodes.slice(0, 15).map(n => ({ id: n.node.id, name: n.node.name, kind: n.node.kind, filePath: n.node.filePath, severity: n.severity })), upstream: impactResult.upstream.nodes.slice(0, 15).map(n => ({ id: n.node.id, name: n.node.name, kind: n.node.kind, filePath: n.node.filePath, severity: n.severity })) }
      if (changeDetectionResult) exploredContext.changeDetection = { filesChanged: changeDetectionResult.files.length, changedSymbols: changeDetectionResult.changedSymbols.slice(0, 20).map(s => ({ id: s.node.id, name: s.node.name, kind: s.node.kind, filePath: s.node.filePath })) }
      if (routeMapResult) exploredContext.routeMap = { routeCount: routeMapResult.routes.length, apiCallCount: routeMapResult.apiCalls.length, routes: routeMapResult.routes.slice(0, 20).map(r => ({ id: r.id, name: r.name, filePath: r.filePath })) }
      if (processes && processes.length > 0) exploredContext.processes = processes.slice(0, 10).map(p => ({ id: p.id, name: p.name, method: p.method, path: p.path }))
    }
    const context: AuraRequestContext = {
      selectedNode: selectedNode ? { id: selectedNode.id, name: selectedNode.name, kind: selectedNode.kind, filePath: selectedNode.filePath, range: selectedNode.range } : null,
      selectedNodeContext: nodeContext ? {
        incoming: nodeContext.incoming.map(i => ({ id: i.node.id, name: i.node.name, kind: i.node.kind, edgeType: i.edgeType, filePath: i.node.filePath })),
        outgoing: nodeContext.outgoing.map(o => ({ id: o.node.id, name: o.node.name, kind: o.node.kind, edgeType: o.edgeType, filePath: o.node.filePath })),
        members: nodeContext.members.map(m => ({ id: m.id, name: m.name, kind: m.kind, filePath: m.filePath })),
        hierarchy: nodeContext.hierarchy.map(h => ({ id: h.node.id, name: h.node.name, kind: h.node.kind, relation: h.relation })),
        containedBy: nodeContext.containedBy ? { id: nodeContext.containedBy.id, name: nodeContext.containedBy.name, kind: nodeContext.containedBy.kind, filePath: nodeContext.containedBy.filePath } : null,
      } : null,
      graphOverview: { nodeCount: graphData?.nodes.length ?? 0, edgeCount: graphData?.edges.length ?? 0, nodeKinds, edgeTypes },
      exploredContext,
    }
    const priorMessages = buildPriorMessages(chatMessages)

    try {
      const res = await fetch(`/api/aura/ask/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context, priorMessages }),
      })

      if (!res.ok) {
        // On second failure, give up and show error
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Ask failed (${res.status})`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      let eventOrder = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim()
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.substring(6))
              const eventType = currentEvent

              if (eventType === 'context_usage') {
                if (data.systemTokens) setSystemPromptTokens(data.systemTokens as number)
                if (data.contextWindow) setContextWindowSize(data.contextWindow as number)
                currentEvent = ''
                continue
              }

              setChatMessages(prev => {
                const updated = [...prev]
                const idx = updated.findIndex(m => m.id === assistantId)
                if (idx === -1) return prev
                const msg = { ...updated[idx] }
                // Reuse the same streaming logic as ask()
                const segments = [...(msg.segments || [])]

                // --- Token ---
                if (eventType === 'token') {
                  msg.content = (msg.content || '') + (data.token || '')
                  segments.push({ type: 'text', content: data.token || '', order: eventOrder++ })
                  msg.segments = segments
                // --- Tool call ---
                } else if (eventType === 'tool_call') {
                  // (same handling as ask — but for retry we just need basic token/tool streaming)
                  const newTc: AuraToolCall = { id: data.tool_call_id || `${data.name}_${eventOrder}`, name: data.name, args: data.args, status: 'running', order: eventOrder++ }
                  msg.toolCalls = [...(msg.toolCalls || []), newTc]
                  msg.content = ''
                  segments.push({ type: 'tool_call', toolCall: newTc, order: newTc.order! })
                  msg.segments = segments
                // --- Tool result ---
                } else if (eventType === 'tool_result') {
                  const tcId = data.tool_call_id
                  const matchedName = data.name as string | undefined
                  const matchAnyFn = (tc: AuraToolCall) => tcId ? tc.toolCallId === tcId : (matchedName != null && tc.name === matchedName)
                  const updatedToolCalls = [...(msg.toolCalls || [])]
                  const tcIdx = updatedToolCalls.findIndex(matchAnyFn)
                  if (tcIdx !== -1) {
                    const tc = { ...updatedToolCalls[tcIdx] }
                    tc.status = data.error ? 'error' : 'completed'
                    tc.result = data.result || data.error || ''
                    updatedToolCalls[tcIdx] = tc
                    msg.toolCalls = updatedToolCalls
                  }
                  const updatedTc = updatedToolCalls.find(matchAnyFn)
                  if (updatedTc) {
                    const segMatchFn = (s: MessageSegment) => s.type === 'tool_call' && s.toolCall != null && matchAnyFn(s.toolCall)
                    msg.segments = (msg.segments || []).map(s => segMatchFn(s) ? { ...s, toolCall: updatedTc } : s)
                  }
                // --- Sub-agent ---
                } else if (eventType === 'sub_agent_start') {
                  const newSa: AuraSubAgentInfo = { taskId: data.taskId, title: data.title || '', task: data.task, type: data.type || 'explore', status: 'running' as const, order: eventOrder++ }
                  msg.subAgents = [...(msg.subAgents || []), newSa]
                } else if (eventType === 'sub_agent_result') {
                  const saIdx = (msg.subAgents || []).findIndex(sa => sa.taskId === data.taskId)
                  if (saIdx !== -1) {
                    const subAgents = [...(msg.subAgents || [])]
                    subAgents[saIdx] = { ...subAgents[saIdx], status: 'completed', result: data.result }
                    msg.subAgents = subAgents
                  }
                // --- Ask user ---
                } else if (eventType === 'ask_user') {
                  const questionTc: AuraToolCall = { id: data.tool_call_id || `ask_user_${eventOrder}`, name: 'ask_user', args: data.args, status: 'pending_approval' as const, order: eventOrder++ }
                  msg.toolCalls = [...(msg.toolCalls || []), questionTc]
                  setPendingApproval({ id: questionTc.id, question: data.args })
                  msg.content = ''
                  segments.push({ type: 'tool_call', toolCall: questionTc, order: questionTc.order! })
                  msg.segments = segments
                // --- Approval result ---
                } else if (eventType === 'approval_result') {
                  const approvalId = data.approval_id as string
                  setPendingApproval(prev => {
                    if (prev && prev.id === approvalId) return null
                    return prev
                  })
                // --- Todo update ---
                } else if (eventType === 'todo_update') {
                  // skip in retry — todo state isn't critical for retry
                // --- Error ---
                } else if (eventType === 'error') {
                  setChatError(data.message || 'An error occurred')
                // --- Done ---
                } else if (eventType === 'done') {
                  // stream finished
                }

                updated[idx] = msg
                return updated
              })

              currentEvent = ''
            } catch {
              // Skip malformed data
            }
          }
        }
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Ask failed')
      setChatMessages(prev => {
        const updated = [...prev]
        const idx = updated.findIndex(m => m.id === assistantId)
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], content: updated[idx].content || `Error: ${err instanceof Error ? err.message : 'Ask failed'}` }
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
      saveChat()
    }
  }, [projectId, graphData, selectedNode, nodeContext, chatMessages, saveChat, searchResults, impactResult, changeDetectionResult, routeMapResult, processes])

  const retryAskRef = useRef(retryAsk)
  retryAskRef.current = retryAsk

  const clearChat = useCallback(() => {
    setChatMessages([])
    setChatError(null)
  }, [])

  const clearChatError = useCallback(() => {
    setChatError(null)
  }, [])

  const respondToApproval = useCallback(async (approvalId: string, approved: boolean, feedback?: string) => {
    setPendingApproval(null)
    if (!projectId) return
    try {
      await fetch(`/api/aura/approve/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, approved, feedback }),
      })
    } catch {
      // Approval response failed — the timeout on the server side will handle it
    }
  }, [projectId])

  // ── Context Usage ──────────────────────────────────────────────────────────

  const [contextWindowSize, setContextWindowSize] = useState(0)
  const [systemPromptTokens, setSystemPromptTokens] = useState(0)

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/aura/context-estimate/${projectId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.systemTokens) setSystemPromptTokens(data.systemTokens)
        if (data?.contextWindow) setContextWindowSize(data.contextWindow)
      })
      .catch(() => {})
  }, [projectId])

  const contextUsagePercent = useMemo(() => {
    if (contextWindowSize === 0) return 0
    const messageTokens = chatMessages.reduce((sum, m) => {
      if (m.role === 'user') return sum + Math.ceil(m.content.length / 4)
      // For assistant messages, use segments as authoritative text source
      let tokens = Math.ceil(getAssistantFullText(m).length / 4)
      // Add write/update tool result tokens (diff-formatted)
      for (const tc of (m.toolCalls || [])) {
        if (WRITE_UPDATE_TOOLS.has(tc.name)) {
          tokens += Math.ceil(JSON.stringify(tc.args).length / 4)
          if (tc.result) {
            const diffText = formatWriteUpdateDiff(tc as { name: string; args: Record<string, unknown>; result: unknown })
            tokens += Math.ceil((diffText || '').length / 4)
          }
        } else if (CONTEXT_TOOLS.has(tc.name)) {
          // ask_user — count args + result
          tokens += Math.ceil(JSON.stringify(tc.args).length / 4)
          if (tc.result) {
            const resStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)
            tokens += Math.ceil(resStr.length / 4)
          }
        }
      }
      // Add sub-agent result tokens
      for (const sa of (m.subAgents || [])) {
        if (sa.result) tokens += Math.ceil(sa.result.length / 4)
        tokens += Math.ceil(sa.title.length / 4) + Math.ceil(sa.task.length / 4)
      }
      return sum + tokens
    }, 0)
    const total = systemPromptTokens + messageTokens
    return Math.min(100, Math.round((total / contextWindowSize) * 100))
  }, [chatMessages, contextWindowSize, systemPromptTokens])

  // Health check: detect if backend or Ollama is offline
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>
    const check = () => {
      fetch('/api/health', { method: 'GET' })
        .then(res => {
          if (!res.ok) { setOffline('backend'); return }
          res.json().then((data: { ollama?: boolean }) => {
            if (!data.ollama) setOffline('ollama')
            else setOffline(null)
          }).catch(() => setOffline(null))
        })
        .catch(() => setOffline('backend'))
    }
    check()
    timer = setInterval(check, 15000)
    return () => clearInterval(timer)
  }, [])

  return {
    graphData,
    indexingStatus,
    selectedNode,
    nodeContext,
    impactResult,
    searchResults,
    loading,
    error,
    startIndexing,
    search,
    selectNode,
    fetchImpact,
    changeDetectionResult,
    renameResult,
    detectChanges,
    rename,
    routeMapResult,
    shapeCheckResult,
    apiImpactResult,
    fetchRouteMap,
    fetchShapeCheck,
    fetchApiImpact,
    processes,
    processDetail,
    fetchProcesses,
    fetchProcessDetail,
    ask,
    chatMessages,
    isStreaming,
    chatError,
    clearChat,
    clearChatError,
    activeChatId,
    startNewChat,
    contextUsagePercent,
    pendingApproval,
    respondToApproval,
    offline,
    reportActivity,
  }
}

// ── Group Hook ────────────────────────────────────────────────────────────────

export function useAuraGroup() {
  const [groups, setGroups] = useState<AuraGroup[]>([])
  const [contracts, setContracts] = useState<AuraContractRegistry | null>(null)
  const [queryResults, setQueryResults] = useState<AuraGroupQueryResult | null>(null)
  const [impactResult, setGroupImpactResult] = useState<AuraGroupImpactResult | null>(null)
  const [contextResult, setGroupContextResult] = useState<AuraGroupContextResult | null>(null)
  const [statusResult, setStatusResult] = useState<AuraGroupStatusResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  // ── List groups ────────────────────────────────────────────────────────────

  const listGroups = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/aura/group')
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const data: AuraGroup[] = await res.json()
      setGroups(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list groups')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Create group ──────────────────────────────────────────────────────────

  const createGroup = useCallback(async (name: string, description: string = '', memberProjectIds: string[] = []) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/aura/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, memberProjectIds }),
      })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const group: AuraGroup = await res.json()
      setGroups(prev => [...prev, group])
      return group
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Update group ──────────────────────────────────────────────────────────

  const updateGroup = useCallback(async (groupId: string, updates: { name?: string; description?: string }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const updated: AuraGroup = await res.json()
      setGroups(prev => prev.map(g => g.id === groupId ? updated : g))
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Delete group ──────────────────────────────────────────────────────────

  const deleteGroup = useCallback(async (groupId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      setGroups(prev => prev.filter(g => g.id !== groupId))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Add member ────────────────────────────────────────────────────────────

  const addMember = useCallback(async (groupId: string, projectId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const updated: AuraGroup = await res.json()
      setGroups(prev => prev.map(g => g.id === groupId ? updated : g))
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Remove member ─────────────────────────────────────────────────────────

  const removeMember = useCallback(async (groupId: string, projectId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}/members/${projectId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const updated: AuraGroup = await res.json()
      setGroups(prev => prev.map(g => g.id === groupId ? updated : g))
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Sync contract registry ────────────────────────────────────────────────

  const syncGroup = useCallback(async (groupId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}/sync`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const registry: AuraContractRegistry = await res.json()
      setContracts(registry)
      return registry
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync group')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Get contracts ─────────────────────────────────────────────────────────

  const getContracts = useCallback(async (groupId: string, filters?: { type?: string; projectId?: string }) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters?.type) params.set('type', filters.type)
      if (filters?.projectId) params.set('projectId', filters.projectId)
      const qs = params.toString()
      const res = await fetch(`/api/aura/group/${groupId}/contracts${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const registry: AuraContractRegistry = await res.json()
      setContracts(registry)
      return registry
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get contracts')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Cross-repo search ─────────────────────────────────────────────────────

  const queryGroup = useCallback(async (groupId: string, query: string, options?: { limit?: number; kinds?: string[]; servicePrefix?: string }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, ...options }),
      })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const result: AuraGroupQueryResult = await res.json()
      setQueryResults(result)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query group')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Group status ──────────────────────────────────────────────────────────

  const getGroupStatus = useCallback(async (groupId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}/status`)
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const result: AuraGroupStatusResult = await res.json()
      setStatusResult(result)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get group status')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Cross-repo impact ─────────────────────────────────────────────────────

  const getGroupImpact = useCallback(async (groupId: string, projectId: string, nodeId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}/impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, nodeId }),
      })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const result: AuraGroupImpactResult = await res.json()
      setGroupImpactResult(result)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get group impact')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Cross-repo context ────────────────────────────────────────────────────

  const getGroupContext = useCallback(async (groupId: string, nodeId: string, servicePrefix?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/aura/group/${groupId}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, servicePrefix }),
      })
      if (!res.ok) throw new Error(await res.json().then(b => b.error || `Failed (${res.status})`))
      const result: AuraGroupContextResult = await res.json()
      setGroupContextResult(result)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get group context')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    groups,
    contracts,
    queryResults,
    impactResult,
    contextResult,
    statusResult,
    loading,
    error,
    clearError,
    listGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    addMember,
    removeMember,
    syncGroup,
    getContracts,
    queryGroup,
    getGroupStatus,
    getGroupImpact,
    getGroupContext,
  }
}