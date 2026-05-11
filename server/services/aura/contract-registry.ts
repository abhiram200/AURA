import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { AuraQueryService } from './graph.ts'
import type {
  AuraNode,
  AuraEdge,
  HttpContract,
  CrossProjectEdge,
  ContractRegistry,
  ResponseShapeField,
} from './types.ts'

// ── URL Matching ──────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

function routePathToPattern(routePath: string): string {
  // /api/users/:id → /^\/api\/users\/[^/]+$/
  const parts = routePath.split('/').filter(Boolean)
  const patternParts = parts.map(p => (p.startsWith(':') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  return `^/${patternParts.join('/')}$`
}

function matchUrlToRoute(url: string, routePath: string): { matched: boolean; confidence: number } {
  const normalizedUrl = normalizeUrl(url)
  const normalizedRoute = normalizeUrl(routePath)

  // Exact match
  if (normalizedUrl === normalizedRoute) return { matched: true, confidence: 1.0 }

  // Template match: URL matches route pattern with params
  try {
    const pattern = routePathToPattern(normalizedRoute)
    const regex = new RegExp(pattern)
    if (regex.test(normalizedUrl)) return { matched: true, confidence: 0.8 }
  } catch {
    // Regex construction failed
  }

  // Prefix match
  if (normalizedUrl.startsWith(normalizedRoute) || normalizedRoute.startsWith(normalizedUrl)) {
    return { matched: true, confidence: 0.6 }
  }

  return { matched: false, confidence: 0 }
}

// ── Contract ID ───────────────────────────────────────────────────────────────

function contractId(method: string, url: string, projectId: string): string {
  const hash = crypto.createHash('sha256').update(`${method} ${url} ${projectId}`).digest('hex').slice(0, 12)
  return `contract-${hash}`
}

// ── Build & Match ─────────────────────────────────────────────────────────────

interface MemberProject {
  projectId: string
  queryService: AuraQueryService
}

export function buildContracts(memberProjects: MemberProject[]): HttpContract[] {
  const contracts: HttpContract[] = []

  for (const { projectId, queryService } of memberProjects) {
    const graph = queryService.getGraph()

    // Provider contracts: Route nodes (excluding MCP tools)
    const routeNodes = graph.nodes.filter(
      n => n.kind === 'Route' && (n.metadata as Record<string, unknown> | undefined)?.toolType !== 'mcp'
    )

    for (const route of routeNodes) {
      const meta = route.metadata as Record<string, unknown> | undefined
      const method = (meta?.method as string) ?? 'GET'
      const routePath = (meta?.path as string) ?? ''
      const responseShape = (meta?.responseShape as ResponseShapeField[] | undefined) ?? []

      contracts.push({
        id: contractId(method, routePath, projectId),
        providerProjectId: projectId,
        method,
        path: routePath,
        pathPattern: routePathToPattern(normalizeUrl(routePath)),
        responseShape,
        consumerProjectId: null,
        consumerNodeId: null,
        sourceRouteNodeId: route.id,
        matched: false,
        matchConfidence: 0,
      })
    }

    // Consumer contracts: ApiCall nodes
    const apiCallNodes = graph.nodes.filter(n => n.kind === 'ApiCall')

    for (const apiCall of apiCallNodes) {
      const meta = apiCall.metadata as Record<string, unknown> | undefined
      const method = (meta?.method as string) ?? 'GET'
      const url = (meta?.url as string) ?? ''

      contracts.push({
        id: contractId(method, url, projectId),
        providerProjectId: '', // consumers don't provide
        method,
        path: url,
        pathPattern: '',
        responseShape: [],
        consumerProjectId: projectId,
        consumerNodeId: apiCall.id,
        sourceRouteNodeId: null,
        matched: false,
        matchConfidence: 0,
      })
    }
  }

  return contracts
}

export function matchContracts(
  contracts: HttpContract[],
  memberProjects: MemberProject[],
): { contracts: HttpContract[]; crossProjectEdges: CrossProjectEdge[] } {
  // Build provider lookup: METHOD path → contracts
  const providerLookup = new Map<string, HttpContract[]>()
  for (const c of contracts) {
    if (c.providerProjectId && c.sourceRouteNodeId) {
      const key = `${c.method} ${normalizeUrl(c.path)}`
      const list = providerLookup.get(key) || []
      list.push(c)
      providerLookup.set(key, list)
    }
  }

  const crossProjectEdges: CrossProjectEdge[] = []
  const updatedContracts = contracts.map(c => ({ ...c }))

  // Match consumer contracts to provider contracts
  for (const consumer of updatedContracts) {
    if (!consumer.consumerProjectId || !consumer.consumerNodeId) continue

    const consumerKey = `${consumer.method} ${normalizeUrl(consumer.path)}`
    const normalizedUrl = normalizeUrl(consumer.path)

    // Try exact method+path match first
    const exactProviders = providerLookup.get(consumerKey) || []
    for (const provider of exactProviders) {
      if (provider.providerProjectId === consumer.consumerProjectId) continue // skip within-project
      consumer.matched = true
      consumer.matchConfidence = 1.0
      consumer.providerProjectId = provider.providerProjectId
      consumer.sourceRouteNodeId = provider.sourceRouteNodeId

      crossProjectEdges.push({
        sourceProjectId: consumer.consumerProjectId,
        sourceNodeId: consumer.consumerNodeId,
        targetProjectId: provider.providerProjectId,
        targetNodeId: provider.sourceRouteNodeId,
        edgeType: 'FETCHES' as const,
        confidence: 1.0,
      })
      break // first exact match wins
    }

    if (consumer.matched) continue

    // Try template/pattern matching across all providers
    for (const provider of contracts) {
      if (!provider.providerProjectId || !provider.sourceRouteNodeId) continue
      if (provider.providerProjectId === consumer.consumerProjectId) continue
      if (provider.method !== consumer.method) continue

      const { matched, confidence } = matchUrlToRoute(normalizedUrl, provider.path)
      if (matched) {
        consumer.matched = true
        consumer.matchConfidence = confidence
        consumer.providerProjectId = provider.providerProjectId
        consumer.sourceRouteNodeId = provider.sourceRouteNodeId

        crossProjectEdges.push({
          sourceProjectId: consumer.consumerProjectId,
          sourceNodeId: consumer.consumerNodeId,
          targetProjectId: provider.providerProjectId,
          targetNodeId: provider.sourceRouteNodeId,
          edgeType: 'FETCHES' as const,
          confidence,
        })
        break
      }
    }
  }

  return { contracts: updatedContracts, crossProjectEdges }
}

// ── Sync (build + match + save) ────────────────────────────────────────────────

export async function syncContracts(
  groupId: string,
  memberProjects: MemberProject[],
  dataDir: string,
): Promise<ContractRegistry> {
  const built = buildContracts(memberProjects)
  const { contracts, crossProjectEdges } = matchContracts(built, memberProjects)

  const registry: ContractRegistry = {
    groupId,
    contracts,
    crossProjectEdges,
    syncedAt: new Date().toISOString(),
    stats: {
      totalContracts: contracts.length,
      matchedContracts: contracts.filter(c => c.matched).length,
      unmatchedContracts: contracts.filter(c => !c.matched).length,
      crossProjectEdges: crossProjectEdges.length,
    },
  }

  // Persist
  const dir = path.join(dataDir, 'groups', groupId)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, 'contracts.json')
  const tmp = filePath + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(registry, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)

  return registry
}

export async function loadContracts(
  groupId: string,
  dataDir: string,
): Promise<ContractRegistry | null> {
  const filePath = path.join(dataDir, 'groups', groupId, 'contracts.json')
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as ContractRegistry
  } catch {
    return null
  }
}