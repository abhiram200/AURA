import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

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
    incoming: { name: string; kind: string; edgeType: string; filePath: string }[]
    outgoing: { name: string; kind: string; edgeType: string; filePath: string }[]
    members: { name: string; kind: string }[]
    hierarchy: { name: string; kind: string; relation: string }[]
  } | null
  graphOverview: {
    nodeCount: number
    edgeCount: number
    nodeKinds: Record<string, number>
    edgeTypes: Record<string, number>
  }
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
            } else if (status.phase === 'error') {
              clearAllPolling()
              setError(status.error || 'Indexing failed')
              setLoading(false)
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

  // ── Auto-load on projectId change (always re-index on project open) ──────

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

        // Always re-index on project open
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
              gitChanged = true
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
    const context: AuraRequestContext = {
      selectedNode: selectedNode ? { id: selectedNode.id, name: selectedNode.name, kind: selectedNode.kind, filePath: selectedNode.filePath, range: selectedNode.range } : null,
      selectedNodeContext: nodeContext ? {
        incoming: nodeContext.incoming.map(i => ({ name: i.node.name, kind: i.node.kind, edgeType: i.edgeType, filePath: i.node.filePath })),
        outgoing: nodeContext.outgoing.map(o => ({ name: o.node.name, kind: o.node.kind, edgeType: o.edgeType, filePath: o.node.filePath })),
        members: nodeContext.members.map(m => ({ name: m.name, kind: m.kind })),
        hierarchy: nodeContext.hierarchy.map(h => ({ name: h.node.name, kind: h.node.kind, relation: h.relation })),
      } : null,
      graphOverview: {
        nodeCount: graphData?.nodes.length ?? 0,
        edgeCount: graphData?.edges.length ?? 0,
        nodeKinds,
        edgeTypes,
      },
    }

    try {
      // Send prior messages so the agent has conversation memory
      const priorMessages = chatMessages.map(m => ({ role: m.role, content: m.content }))

      const res = await fetch(`/api/aura/ask/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context, priorMessages }),
      })

      if (!res.ok) {
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
                  // Update last text segment or create one
                  const segments = msg.segments || []
                  if (segments.length > 0 && segments[segments.length - 1].type === 'text') {
                    segments[segments.length - 1] = { ...segments[segments.length - 1], content: msg.content }
                  } else {
                    segments.push({ type: 'text', content: msg.content, order: eventOrder++ })
                  }
                  msg.segments = [...segments]
                } else if (eventType === 'tool_call') {
                  // Save any accumulated text as a segment, then add tool_call segment
                  const segments = msg.segments || []
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
                  msg.toolCalls = [...(msg.toolCalls || []), newTc]
                  msg.content = '' // Reset content — text before this tool is now in segments
                  segments.push({ type: 'tool_call', toolCall: newTc, order: newTc.order! })
                  msg.segments = [...segments]
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
                  // Detect git commit — trigger immediate re-index
                  if (data.name === 'git') {
                    const cmd = typeof data.args?.command === 'string' ? data.args.command : ''
                    const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? '')
                    if (cmd.includes('commit') || resultStr.includes('commit')) {
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
                  // Save any text as segment, then add sub_agent_start segment
                  const segments = msg.segments || []
                  if (msg.content.trim()) {
                    if (segments.length === 0 || segments[segments.length - 1].type !== 'text') {
                      segments.push({ type: 'text', content: msg.content, order: eventOrder++ })
                    }
                  }
                  msg.content = ''
                  segments.push({ type: 'sub_agent_start', subAgent: newSa, order: newSa.order! })
                  msg.segments = [...segments]
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
                  msg.content += `\n\n⚠️ Error: ${data.message}`
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
    // Count user/assistant message content only (no tools, no sub-agents)
    const messageTokens = chatMessages.reduce((sum, m) => {
      return sum + Math.ceil(m.content.length / 4)
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