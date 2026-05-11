import type { AuraQueryService } from './graph.ts'
import type { AuraNode } from './types.ts'
import type {
  SearchResult,
  SearchMode,
  ImpactResult,
  NodeContext,
  GroupQueryResult,
  GroupImpactResult,
  GroupContextResult,
  GroupStatusResult,
  CrossProjectEdge,
  ContractRegistry,
} from './types.ts'
import type { Group } from './types.ts'
import type { ProjectService } from '../project.ts'
import type { AuraIndexer } from './indexer.ts'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemberProject {
  projectId: string
  projectName: string
  queryService: AuraQueryService
}

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────

const RRF_K = 60

function reciprocalRankFusion(
  projectResults: Array<{ projectId: string; projectName: string; results: SearchResult[] }>,
  options?: { servicePrefix?: string },
): GroupQueryResult {
  const scoreMap = new Map<string, { nodeId: string; projectId: string; projectName: string; node: AuraNode; rrfScore: number }>()

  for (const { projectId, projectName, results } of projectResults) {
    if (options?.servicePrefix && !projectName.toLowerCase().startsWith(options.servicePrefix.toLowerCase())) continue

    for (let rank = 0; rank < results.length; rank++) {
      const { node, score } = results[rank]
      const key = `${projectId}:${node.id}`
      const rrfContrib = 1 / (RRF_K + rank + 1)

      const existing = scoreMap.get(key)
      if (existing) {
        existing.rrfScore += rrfContrib
      } else {
        scoreMap.set(key, { nodeId: node.id, projectId, projectName, node, rrfScore: rrfContrib })
      }
    }
  }

  const ranked = Array.from(scoreMap.values()).sort((a, b) => b.rrfScore - a.rrfScore)

  return {
    results: ranked.map((r, i) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      node: r.node,
      score: r.rrfScore,
      rank: i + 1,
    })),
    mergedScore: ranked.length > 0 ? ranked[0].rrfScore : 0,
  }
}

// ── Group Query Service ───────────────────────────────────────────────────────

export class GroupQueryService {
  // ── Cross-repo search ────────────────────────────────────────────────────────

  async search(
    memberProjects: MemberProject[],
    query: string,
    options?: { limit?: number; kinds?: string[]; servicePrefix?: string; mode?: SearchMode },
  ): Promise<GroupQueryResult> {
    const projectResults: Array<{ projectId: string; projectName: string; results: SearchResult[] }> = []

    for (const { projectId, projectName, queryService } of memberProjects) {
      const results = await queryService.search(query, { limit: options?.limit, kinds: options?.kinds, mode: options?.mode ?? 'hybrid' })
      projectResults.push({ projectId, projectName, results })
    }

    return reciprocalRankFusion(projectResults, { servicePrefix: options?.servicePrefix })
  }

  // ── Cross-repo impact ────────────────────────────────────────────────────────

  impact(
    anchorProjectId: string,
    targetId: string,
    memberProjects: MemberProject[],
    contractRegistry: ContractRegistry | null,
  ): GroupImpactResult | null {
    // Find the anchor project
    const anchor = memberProjects.find(mp => mp.projectId === anchorProjectId)
    if (!anchor) return null

    const targetNode = anchor.queryService.getNode(targetId)
    if (!targetNode) return null

    // Within-project impact
    const withinProject = anchor.queryService.impact(targetId) ?? {
      target: targetId,
      downstream: { files: [], summary: { totalFiles: 0, critical: 0, moderate: 0, low: 0 } },
      upstream: { files: [], summary: { totalFiles: 0, critical: 0, moderate: 0, low: 0 } },
    }

    // Cross-project impact via contract registry
    const crossProjectDownstream: GroupImpactResult['downstream']['crossProject'] = []
    const crossProjectUpstream: GroupImpactResult['upstream']['crossProject'] = []

    if (contractRegistry) {
      // Find cross-project edges where this node is involved
      for (const edge of contractRegistry.crossProjectEdges) {
        if (edge.sourceNodeId === targetId || edge.targetNodeId === targetId) {
          const isDownstream = edge.sourceNodeId === targetId
          const connectedProjectId = isDownstream ? edge.targetProjectId : edge.sourceProjectId
          const connectedNodeId = isDownstream ? edge.targetNodeId : edge.sourceNodeId

          const connectedProject = memberProjects.find(mp => mp.projectId === connectedProjectId)
          if (!connectedProject) continue

          const connectedImpact = connectedProject.queryService.impact(connectedNodeId)
          if (!connectedImpact) continue

          if (isDownstream) {
            crossProjectDownstream.push({
              targetProjectId: connectedProjectId,
              sourceProjectId: anchorProjectId,
              edge,
              downstream: connectedImpact.downstream,
            })
          } else {
            crossProjectUpstream.push({
              targetProjectId: connectedProjectId,
              sourceProjectId: anchorProjectId,
              edge,
              upstream: connectedImpact.upstream,
            })
          }
        }
      }
    }

    return {
      target: {
        projectId: anchorProjectId,
        nodeId: targetId,
        nodeName: targetNode.name,
        nodeKind: targetNode.kind,
      },
      downstream: {
        withinProject,
        crossProject: crossProjectDownstream,
      },
      upstream: {
        withinProject,
        crossProject: crossProjectUpstream,
      },
    }
  }

  // ── Cross-repo context ───────────────────────────────────────────────────────

  context(
    nodeId: string,
    memberProjects: MemberProject[],
    contractRegistry: ContractRegistry | null,
    options?: { servicePrefix?: string },
  ): GroupContextResult | null {
    // Find which project has this node
    let primaryProject: MemberProject | null = null
    let primaryNode: AuraNode | null = null

    for (const mp of memberProjects) {
      if (options?.servicePrefix && !mp.projectName.toLowerCase().startsWith(options.servicePrefix.toLowerCase())) continue
      const node = mp.queryService.getNode(nodeId)
      if (node) {
        primaryProject = mp
        primaryNode = node
        break
      }
    }

    if (!primaryProject || !primaryNode) return null

    // Get context in the primary project
    const primaryContext = primaryProject.queryService.context(nodeId)

    // Get context in other projects (search by name if nodeId differs)
    const memberResults: GroupContextResult['memberResults'] = memberProjects
      .filter(mp => options?.servicePrefix ? mp.projectName.toLowerCase().startsWith(options.servicePrefix.toLowerCase()) : true)
      .map(mp => ({
        projectId: mp.projectId,
        projectName: mp.projectName,
        context: mp.queryService.context(nodeId),
      }))

    // Cross-project references from contract registry
    const crossProjectReferences: GroupContextResult['crossProjectReferences'] = []

    if (contractRegistry) {
      for (const edge of contractRegistry.crossProjectEdges) {
        if (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) {
          const sourceProject = memberProjects.find(mp => mp.projectId === edge.sourceProjectId)
          const targetProject = memberProjects.find(mp => mp.projectId === edge.targetProjectId)
          if (!sourceProject || !targetProject) continue

          const sourceNode = sourceProject.queryService.getNode(edge.sourceNodeId)
          const targetNode = targetProject.queryService.getNode(edge.targetNodeId)

          crossProjectReferences.push({
            sourceProjectId: edge.sourceProjectId,
            sourceNodeId: edge.sourceNodeId,
            sourceNodeName: sourceNode?.name ?? edge.sourceNodeId,
            targetProjectId: edge.targetProjectId,
            targetNodeId: edge.targetNodeId,
            edgeType: edge.edgeType,
            confidence: edge.confidence,
          })
        }
      }
    }

    return {
      target: { projectId: primaryProject.projectId, node: primaryNode },
      memberResults,
      crossProjectReferences,
    }
  }

  // ── Group status ─────────────────────────────────────────────────────────────

  status(
    group: Group,
    memberProjects: MemberProject[],
    contractRegistry: ContractRegistry | null,
    projectService: ProjectService,
    indexerMap: Map<string, AuraIndexer>,
  ): GroupStatusResult {
    const members: GroupStatusResult['members'] = group.memberProjectIds.map(projectId => {
      const mp = memberProjects.find(m => m.projectId === projectId)
      const project = projectService ? null : null // We get project name from mp
      const projectName = mp?.projectName ?? projectId

      let indexed = false
      let lastIndexedAt: string | null = null
      let nodeCount = 0
      let edgeCount = 0

      if (mp) {
        indexed = mp.queryService.isLoaded()
        const meta = mp.queryService.getMeta()
        if (meta) {
          lastIndexedAt = meta.indexedAt
          nodeCount = meta.stats.totalNodes
          edgeCount = meta.stats.totalEdges
        }
      }

      const stale = contractRegistry
        ? (lastIndexedAt ? new Date(lastIndexedAt) > new Date(contractRegistry.syncedAt) : indexed)
        : false

      return { projectId, projectName, indexed, lastIndexedAt, nodeCount, edgeCount, stale }
    })

    return {
      groupId: group.id,
      groupName: group.name,
      members,
      contractRegistry: {
        synced: contractRegistry !== null,
        syncedAt: contractRegistry?.syncedAt ?? null,
        totalContracts: contractRegistry?.stats.totalContracts ?? 0,
        matchedContracts: contractRegistry?.stats.matchedContracts ?? 0,
        stale: false, // will be calculated below
      },
    }
  }
}