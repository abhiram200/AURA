import type { SimEdge } from './ForceSimulation'

/**
 * BFS from selectedId through an undirected adjacency list built from edges.
 * Returns Map<nodeId, depth> where depth 0 = selected node, depth 1 = direct neighbors, etc.
 * Nodes not reachable from selectedId are absent from the map.
 */
export function computeDepthMap(selectedId: string, edges: SimEdge[]): Map<string, number> {
  const adj = new Map<string, Set<string>>()

  for (const edge of edges) {
    let neighbors = adj.get(edge.source)
    if (!neighbors) {
      neighbors = new Set()
      adj.set(edge.source, neighbors)
    }
    neighbors.add(edge.target)

    let neighborsReverse = adj.get(edge.target)
    if (!neighborsReverse) {
      neighborsReverse = new Set()
      adj.set(edge.target, neighborsReverse)
    }
    neighborsReverse.add(edge.source)
  }

  const depthMap = new Map<string, number>()
  const queue: string[] = [selectedId]
  depthMap.set(selectedId, 0)

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depthMap.get(current)!
    const neighbors = adj.get(current)

    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!depthMap.has(neighbor)) {
          depthMap.set(neighbor, currentDepth + 1)
          queue.push(neighbor)
        }
      }
    }
  }

  return depthMap
}

export function getDepthAppearance(
  depth: number | undefined,
  hasSelection: boolean = false
): { brightness: number; emissiveIntensity: number } {
  if (depth === undefined) {
    if (hasSelection) {
      return { brightness: 0.15, emissiveIntensity: 0.05 }
    }
    return { brightness: 1.0, emissiveIntensity: 0.3 }
  }
  if (depth === 0) {
    return { brightness: 1.0, emissiveIntensity: 1.0 }
  }
  if (depth === 1) {
    return { brightness: 0.7, emissiveIntensity: 0.5 }
  }
  if (depth === 2) {
    return { brightness: 0.4, emissiveIntensity: 0.2 }
  }
  // depth 3+
  return { brightness: 0.15, emissiveIntensity: 0.05 }
}

/**
 * Returns edge opacity based on the depth of its source and target nodes.
 * Uses the minimum depth of source and target (treats undefined as 999).
 * No selection (both undefined) → 0.6.
 */
export function getEdgeOpacity(sourceDepth: number | undefined, targetDepth: number | undefined): number {
  if (sourceDepth === undefined && targetDepth === undefined) {
    return 0.85
  }

  const sourceVal = sourceDepth ?? 999
  const targetVal = targetDepth ?? 999
  const minDepth = Math.min(sourceVal, targetVal)

  if (minDepth === 0) return 0.9
  if (minDepth === 1) return 0.7
  if (minDepth === 2) return 0.3
  // minDepth 3+
  return 0.05
}