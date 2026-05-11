import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import {
  SynapseNodeKind,
  SynapseEdgeType,
} from './types.ts'
import type {
  SynapseNode,
  SynapseEdge,
  GraphData,
  SynapseMeta,
  ImpactResult,
  ImpactLevel,
  ImpactNode,
  NodeContext,
  SearchResult,
} from './types.ts'

type AdjacencyEntry = { edge: SynapseEdge; neighbor: SynapseNode }

const IMPACT_LABELS: Record<number, string> = {
  1: 'WILL BREAK',
  2: 'LIKELY AFFECTED',
  3: 'MAY NEED TESTING',
}

export class SynapseQueryService {
  private projectPath: string
  private loaded = false
  private graphData: GraphData = { nodes: [], edges: [] }
  private metaData: SynapseMeta | null = null

  private nodeMap: Map<string, SynapseNode> = new Map()
  private adjacency: Map<string, AdjacencyEntry[]> = new Map()
  private reverseAdjacency: Map<string, AdjacencyEntry[]> = new Map()

  constructor(projectPath: string) {
    this.projectPath = projectPath
  }

  async load(): Promise<void> {
    // Reset all indices
    this.nodeMap.clear()
    this.adjacency.clear()
    this.reverseAdjacency.clear()
    this.graphData = { nodes: [], edges: [] }
    this.metaData = null
    this.loaded = false

    const graphPath = path.join(this.projectPath, '.synapse', 'graph.json')
    const metaPath = path.join(this.projectPath, '.synapse', 'meta.json')

    if (fsSync.existsSync(graphPath)) {
      const graphRaw = await fs.readFile(graphPath, 'utf-8')
      this.graphData = JSON.parse(graphRaw) as GraphData
    }

    if (fsSync.existsSync(metaPath)) {
      const metaRaw = await fs.readFile(metaPath, 'utf-8')
      this.metaData = JSON.parse(metaRaw) as SynapseMeta
    }

    // Build node map
    for (const node of this.graphData.nodes) {
      this.nodeMap.set(node.id, node)
    }

    // Build adjacency and reverse adjacency lists
    for (const edge of this.graphData.edges) {
      // Skip edges where source or target node doesn't exist
      const sourceNode = this.nodeMap.get(edge.source)
      const targetNode = this.nodeMap.get(edge.target)
      if (!sourceNode || !targetNode) continue

      // Forward adjacency: source -> target
      const forwardList = this.adjacency.get(edge.source) ?? []
      forwardList.push({ edge, neighbor: targetNode })
      this.adjacency.set(edge.source, forwardList)

      // Reverse adjacency: target -> source
      const reverseList = this.reverseAdjacency.get(edge.target) ?? []
      reverseList.push({ edge, neighbor: sourceNode })
      this.reverseAdjacency.set(edge.target, reverseList)
    }

    this.loaded = true
  }

  isLoaded(): boolean {
    return this.loaded
  }

  getGraph(): GraphData {
    return this.graphData
  }

  getMeta(): SynapseMeta | null {
    return this.metaData
  }

  getNode(id: string): SynapseNode | null {
    return this.nodeMap.get(id) ?? null
  }

  impact(
    targetId: string,
    direction: 'downstream' | 'upstream',
    maxDepth: number = Infinity,
    minConfidence: number = 0.0,
  ): ImpactResult {
    const result: ImpactResult = {
      target: targetId,
      direction,
      levels: [],
    }

    if (!this.nodeMap.has(targetId)) {
      return result
    }

    // Downstream: follow reverse adjacency (who depends on target)
    // Upstream: follow forward adjacency (what target depends on)
    const adjMap = direction === 'downstream' ? this.reverseAdjacency : this.adjacency

    const visited = new Set<string>([targetId])
    let currentLevelIds = [targetId]

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextLevelIds: string[] = []
      const impactNodes: ImpactNode[] = []

      for (const currentId of currentLevelIds) {
        const neighbors = adjMap.get(currentId) ?? []
        for (const { edge, neighbor } of neighbors) {
          if (visited.has(neighbor.id)) continue
          if (edge.type === SynapseEdgeType.CONTAINS) continue
          if (edge.confidence < minConfidence) continue

          visited.add(neighbor.id)
          nextLevelIds.push(neighbor.id)

          impactNodes.push({
            id: neighbor.id,
            name: neighbor.name,
            kind: neighbor.kind,
            filePath: neighbor.filePath,
            edgeType: edge.type,
            confidence: edge.confidence,
          })
        }
      }

      if (impactNodes.length > 0) {
        const label = IMPACT_LABELS[depth] ?? `DEPTH ${depth}`
        result.levels.push({
          depth,
          label,
          nodes: impactNodes,
        })
      }

      if (nextLevelIds.length === 0) break
      currentLevelIds = nextLevelIds
    }

    return result
  }

  context(nodeId: string): NodeContext | null {
    const node = this.nodeMap.get(nodeId)
    if (!node) return null

    const incoming: { node: SynapseNode; edgeType: SynapseEdgeType }[] = []
    const outgoing: { node: SynapseNode; edgeType: SynapseEdgeType }[] = []
    const members: SynapseNode[] = []
    const hierarchy: { node: SynapseNode; relation: string }[] = []

    // Incoming edges (who references this node)
    const reverseEdges = this.reverseAdjacency.get(nodeId) ?? []
    for (const { edge, neighbor } of reverseEdges) {
      if (edge.type === SynapseEdgeType.CONTAINS) {
        // CONTAINS in reverse means this node is contained by the neighbor
        // We don't include these in incoming
        continue
      }
      incoming.push({ node: neighbor, edgeType: edge.type })
    }

    // Outgoing edges (who this node references)
    const forwardEdges = this.adjacency.get(nodeId) ?? []
    for (const { edge, neighbor } of forwardEdges) {
      if (edge.type === SynapseEdgeType.CONTAINS) {
        // CONTAINS in forward means this node contains the neighbor
        // For Class/Interface nodes, these are members
        members.push(neighbor)
        continue
      }
      outgoing.push({ node: neighbor, edgeType: edge.type })
    }

    // Hierarchy: EXTENDS/IMPLEMENTS in both directions
    // Forward: this node extends/implements another
    for (const { edge, neighbor } of forwardEdges) {
      if (edge.type === SynapseEdgeType.EXTENDS) {
        hierarchy.push({ node: neighbor, relation: 'extends' })
      } else if (edge.type === SynapseEdgeType.IMPLEMENTS) {
        hierarchy.push({ node: neighbor, relation: 'implements' })
      }
    }

    // Reverse: another node extends/implements this one
    for (const { edge, neighbor } of reverseEdges) {
      if (edge.type === SynapseEdgeType.EXTENDS) {
        hierarchy.push({ node: neighbor, relation: 'extended by' })
      } else if (edge.type === SynapseEdgeType.IMPLEMENTS) {
        hierarchy.push({ node: neighbor, relation: 'implemented by' })
      }
    }

    return {
      node,
      incoming,
      outgoing,
      members,
      hierarchy,
    }
  }

  search(query: string, limit: number = 50): SearchResult[] {
    const lowerQuery = query.toLowerCase()
    const results: SearchResult[] = []

    for (const node of this.graphData.nodes) {
      const lowerName = node.name.toLowerCase()
      const lowerPath = node.filePath.toLowerCase()

      let score = 0

      if (lowerName === lowerQuery) {
        score = 1.0
      } else if (lowerName.includes(lowerQuery)) {
        score = 0.7
      } else if (lowerPath.includes(lowerQuery)) {
        score = 0.3
      }

      if (score > 0) {
        results.push({ node, score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  dependents(nodeId: string, depth: number = Infinity): SynapseNode[] {
    const result: SynapseNode[] = []
    const visited = new Set<string>([nodeId])
    let currentLevelIds = [nodeId]

    for (let d = 0; d < depth; d++) {
      const nextLevelIds: string[] = []

      for (const currentId of currentLevelIds) {
        const neighbors = this.reverseAdjacency.get(currentId) ?? []
        for (const { edge, neighbor } of neighbors) {
          if (visited.has(neighbor.id)) continue
          if (edge.type === SynapseEdgeType.CONTAINS) continue

          visited.add(neighbor.id)
          nextLevelIds.push(neighbor.id)
          result.push(neighbor)
        }
      }

      if (nextLevelIds.length === 0) break
      currentLevelIds = nextLevelIds
    }

    return result
  }

  dependencies(nodeId: string, depth: number = Infinity): SynapseNode[] {
    const result: SynapseNode[] = []
    const visited = new Set<string>([nodeId])
    let currentLevelIds = [nodeId]

    for (let d = 0; d < depth; d++) {
      const nextLevelIds: string[] = []

      for (const currentId of currentLevelIds) {
        const neighbors = this.adjacency.get(currentId) ?? []
        for (const { edge, neighbor } of neighbors) {
          if (visited.has(neighbor.id)) continue
          if (edge.type === SynapseEdgeType.CONTAINS) continue

          visited.add(neighbor.id)
          nextLevelIds.push(neighbor.id)
          result.push(neighbor)
        }
      }

      if (nextLevelIds.length === 0) break
      currentLevelIds = nextLevelIds
    }

    return result
  }
}