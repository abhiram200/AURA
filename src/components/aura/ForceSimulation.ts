import type { AuraNodeData, AuraEdgeData } from '../../hooks/useAura'

// ── Color Maps (GitHub Dark theme) ─────────────────────────────────────────────

export const NODE_COLORS: Record<string, string> = {
  File: '#58a6ff',
  Folder: '#8b949e',
  Function: '#3fb950',
  Class: '#d29922',
  Interface: '#bc8cff',
  Method: '#f0883e',
  Variable: '#f778ba',
  Route: '#ff6b6b',
  ApiCall: '#ffa94d',
}

// File extension color map — used in file mode to differentiate file types
export const FILE_EXT_COLORS: Record<string, string> = {
  '.ts': '#58a6ff',
  '.tsx': '#58a6ff',
  '.js': '#e8d44d',
  '.jsx': '#e8d44d',
  '.mjs': '#e8d44d',
  '.css': '#bc8cff',
  '.scss': '#bc8cff',
  '.less': '#bc8cff',
  '.html': '#f0883e',
  '.json': '#3fb950',
  '.md': '#8b949e',
  '.mdx': '#8b949e',
  '.yaml': '#e8a855',
  '.yml': '#e8a855',
  '.py': '#58a6ff',
  '.svg': '#f778ba',
  '.png': '#f778ba',
  '.jpg': '#f778ba',
  '.gif': '#f778ba',
  '.env': '#f47067',
  '.config': '#8b949e',
  '.toml': '#e8a855',
  '.lock': '#484f58',
}

export const EDGE_COLORS: Record<string, string> = {
  IMPORTS: '#58a6ff',
  CALLS: '#bc8cff',
  EXTENDS: '#d29922',
  IMPLEMENTS: '#f778ba',
  CONTAINS: '#3fb950',
  DEPENDS_ON: '#8b949e',
  HAS_METHOD: '#f0883e',
  HAS_PROPERTY: '#484f58',
  TYPEOF: '#7ee8fa',
  TYPE_ALIAS: '#a78bfa',
  FLOWS_TO: '#22d3ee',
  HANDLES: '#ff6b6b',
  FETCHES: '#ffa94d',
  MIDDLEWARE: '#868e96',
}

// ── File extension color helper ───────────────────────────────────────────────

export function getFileColor(filePath: string): string {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase()
  return FILE_EXT_COLORS[ext] ?? NODE_COLORS.File
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SimNode {
  id: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  kind: string
  name: string
  filePath: string
  degree: number
  baseRadius: number
  color: string
}

export interface SimEdge {
  source: string
  target: string
  type: string
  confidence: number
}

// ── Force Simulation ──────────────────────────────────────────────────────────

export class ForceSimulation {
  nodes: Map<string, SimNode> = new Map()
  edges: SimEdge[] = []

  private _stable = false
  private _iterations = 0
  private viewMode: 'file' | 'symbol' | 'hybrid' = 'file'

  // ── Constants ──────────────────────────────────────────────────────────────

  private static readonly CHARGE = -300
  private static readonly SPRING_STRENGTH = 0.01
  private static readonly CENTERING = -0.005
  private static readonly DAMPING = 0.85
  private static readonly MAX_ITERATIONS = 300
  private static readonly STABILITY_THRESHOLD = 0.01
  private static readonly SPHERE_RADIUS = 50
  private static readonly CONTAINS_SPRING_STRENGTH = 0.005

  // ── Public API ─────────────────────────────────────────────────────────────

  get stable(): boolean {
    return this._stable
  }

  load(
    nodes: AuraNodeData[],
    edges: AuraEdgeData[],
    viewMode: 'file' | 'symbol' | 'hybrid',
    nodeFilters: Set<string>,
    edgeFilters: Set<string>,
  ): void {
    // Reset state
    this.nodes.clear()
    this.edges = []
    this._iterations = 0
    this._stable = false
    this.viewMode = viewMode

    // ── Filter nodes ────────────────────────────────────────────────────────

    const filteredNodes: AuraNodeData[] = []
    for (const node of nodes) {
      // In file view, only include nodes without ':' in id (file/folder nodes)
      if (viewMode === 'file' && node.id.includes(':')) continue
      // Symbol and hybrid modes include all nodes (file + symbol)
      // Apply node kind filters
      if (!nodeFilters.has(node.kind)) continue
      filteredNodes.push(node)
    }

    // ── Create SimNodes with random spherical positions ─────────────────────

    for (const node of filteredNodes) {
      // Uniform random point on/inside sphere using spherical coordinates
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = ForceSimulation.SPHERE_RADIUS * Math.cbrt(Math.random())

      let color: string
      if (viewMode === 'file') {
        color = getFileColor(node.filePath)
      } else if (viewMode === 'symbol') {
        color = NODE_COLORS[node.kind] ?? '#8b949e'
      } else {
        // hybrid: file nodes by extension, symbol nodes by kind
        color = (node.kind === 'File' || node.kind === 'Folder')
          ? getFileColor(node.filePath)
          : (NODE_COLORS[node.kind] ?? '#8b949e')
      }

      this.nodes.set(node.id, {
        id: node.id,
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta),
        z: r * Math.cos(phi),
        vx: 0,
        vy: 0,
        vz: 0,
        kind: node.kind,
        name: node.name,
        filePath: node.filePath,
        degree: 0,
        baseRadius: 0,
        color,
      })
    }

    // ── Filter & deduplicate edges ─────────────────────────────────────────

    const seenEdges = new Set<string>()
    const filteredEdges: SimEdge[] = []

    for (const edge of edges) {
      // In file view, only include DEPENDS_ON edges
      if (viewMode === 'file' && edge.type !== 'DEPENDS_ON') continue
      // In symbol mode, skip CONTAINS edges
      if (viewMode === 'symbol' && edge.type === 'CONTAINS') continue
      // In hybrid mode, skip HAS_METHOD and HAS_PROPERTY but include everything else (including CONTAINS)
      if (viewMode === 'hybrid' && (edge.type === 'HAS_METHOD' || edge.type === 'HAS_PROPERTY')) continue
      // Apply edge type filters
      if (!edgeFilters.has(edge.type)) continue
      // Skip self-edges
      if (edge.source === edge.target) continue
      // Skip edges referencing missing nodes
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) continue

      // Deduplicate by key
      const key = `${edge.source}-${edge.type}-${edge.target}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)

      filteredEdges.push({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        confidence: edge.confidence,
      })
    }

    this.edges = filteredEdges

    // ── Compute degree ──────────────────────────────────────────────────────

    for (const edge of this.edges) {
      const src = this.nodes.get(edge.source)
      const tgt = this.nodes.get(edge.target)
      if (src) src.degree++
      if (tgt) tgt.degree++
    }

    // ── Compute baseRadius ──────────────────────────────────────────────────

    for (const node of this.nodes.values()) {
      let base: number
      if (viewMode === 'hybrid') {
        base = (node.kind === 'File' || node.kind === 'Folder') ? 1.5 : 0.6
      } else {
        base = (node.kind === 'File' || node.kind === 'Folder') ? 0.8 : 0.6
      }
      node.baseRadius = Math.min(base + node.degree * 0.12, 2.0)
    }
  }

  tick(): boolean {
    if (this._stable) return true

    this._iterations++

    const nodeArr = Array.from(this.nodes.values())
    const n = nodeArr.length

    // ── Repulsion (Coulomb force: charge / distance²) ──────────────────────

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodeArr[i]
        const b = nodeArr[j]

        const dx = b.x - a.x
        const dy = b.y - a.y
        const dz = b.z - a.z

        const distSq = dx * dx + dy * dy + dz * dz + 0.1 // avoid division by zero
        const dist = Math.sqrt(distSq)

        const force = ForceSimulation.CHARGE / distSq
        const fx = (force * dx) / dist
        const fy = (force * dy) / dist
        const fz = (force * dz) / dist

        a.vx -= fx
        a.vy -= fy
        a.vz -= fz
        b.vx += fx
        b.vy += fy
        b.vz += fz
      }
    }

    // ── Attraction (spring: distance * springStrength for edges) ────────────

    for (const edge of this.edges) {
      const src = this.nodes.get(edge.source)
      const tgt = this.nodes.get(edge.target)
      if (!src || !tgt) continue

      const dx = tgt.x - src.x
      const dy = tgt.y - src.y
      const dz = tgt.z - src.z

      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const springK = (this.viewMode === 'hybrid' && edge.type === 'CONTAINS')
        ? ForceSimulation.CONTAINS_SPRING_STRENGTH
        : ForceSimulation.SPRING_STRENGTH
      const force = dist * springK

      const fx = (force * dx) / (dist || 1)
      const fy = (force * dy) / (dist || 1)
      const fz = (force * dz) / (dist || 1)

      src.vx += fx
      src.vy += fy
      src.vz += fz
      tgt.vx -= fx
      tgt.vy -= fy
      tgt.vz -= fz
    }

    // ── Centering & damping ────────────────────────────────────────────────

    let kineticEnergy = 0

    for (const node of nodeArr) {
      // Centering force
      node.vx += ForceSimulation.CENTERING * node.x
      node.vy += ForceSimulation.CENTERING * node.y
      node.vz += ForceSimulation.CENTERING * node.z

      // Damping
      node.vx *= ForceSimulation.DAMPING
      node.vy *= ForceSimulation.DAMPING
      node.vz *= ForceSimulation.DAMPING

      // Update positions
      node.x += node.vx
      node.y += node.vy
      node.z += node.vz

      // Track kinetic energy
      kineticEnergy += node.vx * node.vx + node.vy * node.vy + node.vz * node.vz
    }

    // ── Stability check ─────────────────────────────────────────────────────

    if (kineticEnergy < ForceSimulation.STABILITY_THRESHOLD || this._iterations >= ForceSimulation.MAX_ITERATIONS) {
      this._stable = true
    }

    return this._stable
  }
}