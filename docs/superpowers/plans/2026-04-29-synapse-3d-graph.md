# SYNAPSE 3D Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2D Sigma.js graph visualization with a 3D interactive force-directed graph using React Three Fiber, with GitHub-dark colors, depth-based selection dimming, and an "Optimizing layout..." stabilization indicator.

**Architecture:** Custom force simulation (no Sigma.js/Graphology layout deps) runs in `useEffect` with `requestAnimationFrame`. Nodes rendered as 3D spheres via R3F `<mesh>` components, edges as Three.js `Line` objects. Depth map computed via BFS for selection dimming. Camera uses Drei `<OrbitControls>` with auto-rotation.

**Tech Stack:** React Three Fiber (`@react-three/fiber`), Drei (`@react-three/drei`), Three.js (`three`). All already installed.

---

## File Structure

| File                                           | Action   | Responsibility                                        |
|------------------------------------------------|----------|-------------------------------------------------------|
| `src/components/synapse/SynapseGraph.tsx`       | Rewrite  | Main 3D graph component — Canvas, scene, simulation  |
| `src/components/synapse/ForceSimulation.ts`      | Create   | Force-directed layout engine (pure functions, no React) |
| `src/components/synapse/GraphScene.tsx`          | Create   | R3F scene — renders nodes, edges, controls           |
| `src/components/synapse/GraphNodes.tsx`           | Create   | Instanced mesh node renderer with depth-based opacity |
| `src/components/synapse/GraphEdges.tsx`           | Create   | Line-based edge renderer with colored, directional edges |
| `src/components/synapse/OptimizingIndicator.tsx`  | Create   | "Optimizing layout..." banner overlay                  |
| `src/styles/synapse.css`                         | Modify   | Replace 2D graph styles with 3D container styles      |
| `package.json`                                  | Modify   | Remove `sigma`, `graphology-layout-forceatlas2`, `graphology-layout-noverlap` |

**Unchanged files:** `useSynapse.ts`, `SynapsePage.tsx`, `SynapsePanel.tsx`, `SynapseToolbar.tsx`, `SynapseProgress.tsx`, all backend code.

---

### Task 1: Force Simulation Engine

**Files:**
- Create: `src/components/synapse/ForceSimulation.ts`

This task creates a standalone force simulation module with no React dependencies. It exports a `ForceSimulation` class that manages node positions, velocities, and forces.

- [ ] **Step 1: Create `ForceSimulation.ts` with types and constructor**

```typescript
import type { SynapseNodeData, SynapseEdgeData } from '../../hooks/useSynapse'

// ── Color Maps (GitHub Dark) ──────────────────────────────────────────────────

export const NODE_COLORS: Record<string, string> = {
  File: '#58a6ff',
  Folder: '#8b949e',
  Function: '#3fb950',
  Class: '#d29922',
  Interface: '#bc8cff',
  Method: '#f0883e',
  Variable: '#f778ba',
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
}

// ── Simulation Node/Edge ──────────────────────────────────────────────────────

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
}

export interface SimEdge {
  source: string
  target: string
  type: string
  confidence: number
}

// ── Force Parameters ───────────────────────────────────────────────────────────

const CHARGE = -300
const SPRING_STRENGTH = 0.01
const CENTERING = -0.005
const DAMPING = 0.85
const MAX_ITERATIONS = 300
const STABLE_THRESHOLD = 0.01
const SPHERE_RADIUS = 50

// ── Simulation Class ───────────────────────────────────────────────────────────

export class ForceSimulation {
  nodes: Map<string, SimNode> = new Map()
  edges: SimEdge[] = []
  private iterations = 0
  private _stable = false

  get stable(): boolean {
    return this._stable
  }

  load(nodes: SynapseNodeData[], edges: SynapseEdgeData[], viewMode: 'file' | 'symbol', nodeFilters: Set<string>, edgeFilters: Set<string>): void {
    this.nodes.clear()
    this.edges = []
    this.iterations = 0
    this._stable = false

    // Filter nodes and edges based on viewMode and filters
    const filteredNodes =
      viewMode === 'file'
        ? nodes.filter((n) => !n.id.includes(':'))
        : nodes

    const filteredEdges =
      viewMode === 'file'
        ? edges.filter((e) => e.type === 'DEPENDS_ON')
        : edges

    const visibleNodes = filteredNodes.filter((n) => nodeFilters.has(n.kind))
    const visibleEdges = filteredEdges.filter((e) => edgeFilters.has(e.type))

    // Assign random initial positions within a sphere
    for (const node of visibleNodes) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.random() * SPHERE_RADIUS

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
        baseRadius: node.kind === 'File' || node.kind === 'Folder' ? 0.3 : 0.25,
      })
    }

    const nodeIds = new Set(visibleNodes.map((n) => n.id))
    const edgeKeys = new Set<string>()

    for (const edge of visibleEdges) {
      if (edge.source === edge.target) continue
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue

      const edgeKey = `${edge.source}-${edge.type}-${edge.target}`
      if (edgeKeys.has(edgeKey)) continue
      edgeKeys.add(edgeKey)

      this.edges.push({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        confidence: edge.confidence,
      })

      // Increment degree for both endpoints
      const src = this.nodes.get(edge.source)
      const tgt = this.nodes.get(edge.target)
      if (src) src.degree++
      if (tgt) tgt.degree++
    }

    // Update radii based on degree
    for (const node of this.nodes.values()) {
      node.baseRadius = Math.min(0.8, (node.kind === 'File' || node.kind === 'Folder' ? 0.3 : 0.25) + node.degree * 0.05)
    }
  }

  tick(): boolean {
    if (this._stable || this.nodes.size === 0) {
      return true
    }

    const nodeArray = Array.from(this.nodes.values())

    // Repulsion (Coulomb)
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const a = nodeArray[i]
        const b = nodeArray[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dz = b.z - a.z
        const distSq = dx * dx + dy * dy + dz * dz + 0.1 // avoid div by zero
        const dist = Math.sqrt(distSq)
        const force = CHARGE / distSq
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        const fz = (dz / dist) * force

        a.vx -= fx
        a.vy -= fy
        a.vz -= fz
        b.vx += fx
        b.vy += fy
        b.vz += fz
      }
    }

    // Attraction (Spring) — edges
    for (const edge of this.edges) {
      const a = this.nodes.get(edge.source)
      const b = this.nodes.get(edge.target)
      if (!a || !b) continue

      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1
      const force = dist * SPRING_STRENGTH
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      const fz = (dz / dist) * force

      a.vx += fx
      a.vy += fy
      a.vz += fz
      b.vx -= fx
      b.vy -= fy
      b.vz -= fz
    }

    // Centering + Damping + Apply velocities
    let kineticEnergy = 0

    for (const node of nodeArray) {
      // Centering force
      node.vx += node.x * CENTERING
      node.vy += node.y * CENTERING
      node.vz += node.z * CENTERING

      // Damping
      node.vx *= DAMPING
      node.vy *= DAMPING
      node.vz *= DAMPING

      // Apply
      node.x += node.vx
      node.y += node.vy
      node.z += node.vz

      kineticEnergy += node.vx * node.vx + node.vy * node.vy + node.vz * node.vz
    }

    this.iterations++

    if (this.iterations >= MAX_ITERATIONS || kineticEnergy < STABLE_THRESHOLD) {
      this._stable = true
      return true
    }

    return false
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /c/Users/abhir/Desktop/claude && npx tsc --noEmit src/components/synapse/ForceSimulation.ts 2>&1 | head -20`
Expected: No errors (or only import path resolution issues that will resolve once the full project compiles)

- [ ] **Step 3: Commit**

```bash
git add src/components/synapse/ForceSimulation.ts
git commit -m "feat(synapse): add force simulation engine for 3D graph layout"
```

---

### Task 2: Depth Map Utility

**Files:**
- Create: `src/components/synapse/depthMap.ts`

This task creates a pure function that computes the BFS depth map from a selected node, used for depth-based selection visibility.

- [ ] **Step 1: Create `depthMap.ts`**

```typescript
import type { SimEdge } from './ForceSimulation'

/**
 * Compute shortest-path depth from a selected node using BFS.
 * Returns a Map<nodeId, depth> where depth 0 = selected node,
 * depth 1 = direct neighbors, etc. Nodes not reachable get depth = Infinity.
 */
export function computeDepthMap(
  selectedId: string,
  edges: SimEdge[]
): Map<string, number> {
  const depthMap = new Map<string, number>()
  depthMap.set(selectedId, 0)

  // Build adjacency list (undirected — traverse both directions)
  const adj = new Map<string, string[]>()
  for (const edge of edges) {
    let list = adj.get(edge.source)
    if (!list) {
      list = []
      adj.set(edge.source, list)
    }
    list.push(edge.target)

    let list2 = adj.get(edge.target)
    if (!list2) {
      list2 = []
      adj.set(edge.target, list2)
    }
    list2.push(edge.source)
  }

  // BFS
  const queue = [selectedId]
  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depthMap.get(current) ?? 0
    const neighbors = adj.get(current) ?? []

    for (const neighbor of neighbors) {
      if (!depthMap.has(neighbor)) {
        depthMap.set(neighbor, currentDepth + 1)
        queue.push(neighbor)
      }
    }
  }

  return depthMap
}

/**
 * Get opacity and emissive intensity for a node at a given depth.
 * No selection (depth undefined) = default lit state.
 */
export function getDepthAppearance(depth: number | undefined): {
  opacity: number
  emissiveIntensity: number
} {
  if (depth === undefined) {
    return { opacity: 0.85, emissiveIntensity: 0.3 }
  }
  switch (depth) {
    case 0:
      return { opacity: 1.0, emissiveIntensity: 1.0 }
    case 1:
      return { opacity: 0.7, emissiveIntensity: 0.5 }
    case 2:
      return { opacity: 0.35, emissiveIntensity: 0.2 }
    default:
      return { opacity: 0.1, emissiveIntensity: 0.0 }
  }
}

/**
 * Get opacity for an edge based on the max depth of its connected nodes.
 * Uses the higher (more visible) depth of source and target.
 */
export function getEdgeOpacity(sourceDepth: number | undefined, targetDepth: number | undefined): number {
  // If no selection, default edge opacity
  if (sourceDepth === undefined && targetDepth === undefined) {
    return 0.6
  }

  const sd = sourceDepth ?? 999
  const td = targetDepth ?? 999
  const minDepth = Math.min(sd, td)

  switch (minDepth) {
    case 0:
      return 0.9
    case 1:
      return 0.7
    case 2:
      return 0.3
    default:
      return 0.05
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /c/Users/abhir/Desktop/claude && npx tsc --noEmit src/components/synapse/depthMap.ts 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/synapse/depthMap.ts
git commit -m "feat(synapse): add BFS depth map utility for selection visibility"
```

---

### Task 3: Optimizing Indicator Component

**Files:**
- Create: `src/components/synapse/OptimizingIndicator.tsx`
- Modify: `src/styles/synapse.css` (add optimizing indicator styles)

This task creates the "Optimizing layout..." banner that shows while the force simulation stabilizes.

- [ ] **Step 1: Add optimizing indicator CSS to `synapse.css`**

Append after the `.synapse-tooltip__kind` rule (end of file):

```css
/* ── 3D Optimizing Indicator ──────────────────────────────────────────────────── */

.synapse-3d-optimizing {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(13, 17, 23, 0.85);
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 6px 14px;
  color: #8b949e;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.3s;
  z-index: 20;
  pointer-events: none;
}

.synapse-3d-optimizing--hidden {
  opacity: 0;
}

.synapse-3d-optimizing__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #58a6ff;
  animation: synapse-pulse 1.2s ease-in-out infinite;
}

@keyframes synapse-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* ── 3D Graph Container ──────────────────────────────────────────────────────── */

.synapse-3d-canvas {
  width: 100%;
  height: 100%;
  background: #0d1117;
}
```

Also update the existing `.synapse-graph` and `.synapse-graph-wrapper` styles:

Replace:
```css
.synapse-graph-wrapper {
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.synapse-graph {
  width: 100%;
  height: 100%;
}
```

With:
```css
.synapse-graph-wrapper {
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
}
```

(Remove `.synapse-graph` rule — the 3D canvas class `.synapse-3d-canvas` replaces it.)

- [ ] **Step 2: Create `OptimizingIndicator.tsx`**

```typescript
interface OptimizingIndicatorProps {
  visible: boolean
}

export function OptimizingIndicator({ visible }: OptimizingIndicatorProps) {
  return (
    <div className={`synapse-3d-optimizing${visible ? '' : ' synapse-3d-optimizing--hidden'}`}>
      <span className="synapse-3d-optimizing__dot" />
      Optimizing layout...
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/synapse/OptimizingIndicator.tsx src/styles/synapse.css
git commit -m "feat(synapse): add optimizing indicator component and 3D canvas styles"
```

---

### Task 4: Graph Nodes Component

**Files:**
- Create: `src/components/synapse/GraphNodes.tsx`

This task creates the instanced mesh renderer for nodes with depth-based opacity and hover labels.

- [ ] **Step 1: Create `GraphNodes.tsx`**

```typescript
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { SimNode } from './ForceSimulation'
import { NODE_COLORS } from './ForceSimulation'
import { getDepthAppearance } from './depthMap'

interface GraphNodesProps {
  nodes: Map<string, SimNode>
  depthMap: Map<string, number>
  hoveredNodeId: string | null
  selectedNodeId: string | null
  onNodeClick: (node: SimNode) => void
  onNodeHover: (node: SimNode | null) => void
}

// Reusable geometry and default material
const sphereGeometry = new THREE.SphereGeometry(1, 16, 12)
const defaultColor = new THREE.Color('#8b949e')

export function GraphNodes({
  nodes,
  depthMap,
  hoveredNodeId,
  selectedNodeId,
  onNodeClick,
  onNodeHover,
}: GraphNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const nodeArray = useMemo(() => Array.from(nodes.values()), [nodes])
  const hasSelection = selectedNodeId !== null

  // Build color and transform arrays
  const colorArray = useMemo(() => {
    const colors = new Float32Array(nodeArray.length * 3)
    nodeArray.forEach((node, i) => {
      const hex = NODE_COLORS[node.kind] ?? '#8b949e'
      const color = new THREE.Color(hex)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    })
    return colors
  }, [nodeArray])

  // Per-frame update for positions, scales, and opacity
  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const dummy = new THREE.Object3D()

    nodeArray.forEach((node, i) => {
      dummy.position.set(node.x, node.y, node.z)
      dummy.scale.setScalar(node.baseRadius)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true

    // Update instance colors based on depth
    if (hasSelection) {
      nodeArray.forEach((node, i) => {
        const depth = depthMap.get(node.id)
        const appearance = getDepthAppearance(depth)
        const hex = NODE_COLORS[node.kind] ?? '#8b949e'
        const color = new THREE.Color(hex)
        color.multiplyScalar(appearance.opacity)
        mesh.setColorAt(i, color)
      })
    } else {
      nodeArray.forEach((_, i) => {
        mesh.setColorAt(i, new THREE.Color(colorArray[i * 3], colorArray[i * 3 + 1], colorArray[i * 3 + 2]))
      })
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  // Click handler via raycast
  const handleClick = (e: THREE.Event & { instanceId?: number }) => {
    if (e.instanceId !== undefined && e.instanceId < nodeArray.length) {
      onNodeClick(nodeArray[e.instanceId])
    }
  }

  const handlePointerOver = (e: THREE.Event & { instanceId?: number }) => {
    if (e.instanceId !== undefined && e.instanceId < nodeArray.length) {
      onNodeHover(nodeArray[e.instanceId])
    }
  }

  const handlePointerOut = () => {
    onNodeHover(null)
  }

  // Hovered node label
  const hoveredNode = hoveredNodeId ? nodes.get(hoveredNodeId) : null

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[sphereGeometry, undefined, nodeArray.length]}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <meshStandardMaterial
          vertexColors
          emissive={defaultColor}
          emissiveIntensity={0.3}
          roughness={0.4}
          metalness={0.1}
        />
      </instancedMesh>
      {hoveredNode && (
        <Html
          position={[hoveredNode.x, hoveredNode.y + hoveredNode.baseRadius + 0.3, hoveredNode.z]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(13, 17, 23, 0.9)',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '4px 8px',
            color: '#c9d1d9',
            fontSize: 12,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
          }}>
            <div style={{ fontWeight: 600 }}>{hoveredNode.name}</div>
            <div style={{ fontSize: 10, color: '#8b949e' }}>{hoveredNode.filePath}</div>
          </div>
        </Html>
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /c/Users/abhir/Desktop/claude && npx tsc --noEmit src/components/synapse/GraphNodes.tsx 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/synapse/GraphNodes.tsx
git commit -m "feat(synapse): add instanced mesh node renderer with depth-based visibility"
```

---

### Task 5: Graph Edges Component

**Files:**
- Create: `src/components/synapse/GraphEdges.tsx`

This task creates the line-based edge renderer with colored edges and directional cone arrows.

- [ ] **Step 1: Create `GraphEdges.tsx`**

```typescript
import { useMemo } from 'react'
import * as THREE from 'three'
import type { SimNode, SimEdge } from './ForceSimulation'
import { EDGE_COLORS } from './ForceSimulation'
import { getEdgeOpacity } from './depthMap'

interface GraphEdgesProps {
  nodes: Map<string, SimNode>
  edges: SimEdge[]
  depthMap: Map<string, number>
  hasSelection: boolean
}

// Cone geometry for arrow heads
const coneGeometry = new THREE.ConeGeometry(0.08, 0.2, 6)
const coneRotation = new THREE.Euler(Math.PI / 2, 0, 0)

export function GraphEdges({ nodes, edges, depthMap, hasSelection }: GraphEdgesProps) {
  const { lineSegments, arrows } = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const arrowData: { position: [number, number, number]; rotation: THREE.Euler; color: string; opacity: number }[] = []

    for (const edge of edges) {
      const src = nodes.get(edge.source)
      const tgt = nodes.get(edge.target)
      if (!src || !tgt) continue

      const hex = EDGE_COLORS[edge.type] ?? '#8b949e'
      const color = new THREE.Color(hex)

      // Edge opacity based on depth
      const srcDepth = hasSelection ? depthMap.get(edge.source) : undefined
      const tgtDepth = hasSelection ? depthMap.get(edge.target) : undefined
      const opacity = getEdgeOpacity(srcDepth, tgtDepth)
      const adjustedColor = color.clone().multiplyScalar(opacity)

      positions.push(src.x, src.y, src.z, tgt.x, tgt.y, tgt.z)
      colors.push(adjustedColor.r, adjustedColor.g, adjustedColor.b, adjustedColor.r, adjustedColor.g, adjustedColor.b)

      // Arrow at midpoint
      const mx = (src.x + tgt.x) / 2
      const my = (src.y + tgt.y) / 2
      const mz = (src.z + tgt.z) / 2
      const direction = new THREE.Vector3(tgt.x - src.x, tgt.y - src.y, tgt.z - src.z).normalize()
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)

      arrowData.push({
        position: [mx, my, mz],
        rotation: new THREE.Euler().setFromQuaternion(quat),
        color: hex,
        opacity,
      })
    }

    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    return { lineSegments: lineGeometry, arrows: arrowData }
  }, [nodes, edges, depthMap, hasSelection])

  if (edges.length === 0) return null

  return (
    <>
      <lineSegments geometry={lineSegments}>
        <lineBasicMaterial vertexColors transparent opacity={0.6} />
      </lineSegments>
      {arrows.map((arrow, i) => (
        <mesh
          key={i}
          position={arrow.position}
          rotation={arrow.rotation}
          geometry={coneGeometry}
        >
          <meshStandardMaterial
            color={arrow.color}
            transparent
            opacity={arrow.opacity}
            emissive={arrow.color}
            emissiveIntensity={0.2}
          />
        </mesh>
      ))}
    </>
  )
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /c/Users/abhir/Desktop/claude && npx tsc --noEmit src/components/synapse/GraphEdges.tsx 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/synapse/GraphEdges.tsx
git commit -m "feat(synapse): add colored edge renderer with directional arrows"
```

---

### Task 6: Graph Scene Component

**Files:**
- Create: `src/components/synapse/GraphScene.tsx`

This task creates the R3F scene component that combines nodes, edges, camera, and lighting.

- [ ] **Step 1: Create `GraphScene.tsx`**

```typescript
import { useRef, useState, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { SimNode } from './ForceSimulation'
import { ForceSimulation } from './ForceSimulation'
import { computeDepthMap } from './depthMap'
import { GraphNodes } from './GraphNodes'
import { GraphEdges } from './GraphEdges'

interface GraphSceneProps {
  nodes: SimNode[]
  edges: ReturnType<ForceSimulation['load']> extends void ? never : ForceSimulation
  simulation: ForceSimulation
  selectedNodeId: string | null
  onNodeClick: (node: SimNode) => void
  onNodeHover: (node: SimNode | null) => void
  onStableChange: (stable: boolean) => void
}

function SceneContent({
  simulation,
  selectedNodeId,
  onNodeClick,
  onNodeHover,
  onStableChange,
}: {
  simulation: ForceSimulation
  selectedNodeId: string | null
  onNodeClick: (node: SimNode) => void
  onNodeHover: (node: SimNode | null) => void
  onStableChange: (stable: boolean) => void
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const stableRef = useRef(false)

  // Depth map for selection visibility
  const depthMap = computeDepthMap(
    selectedNodeId ?? '',
    simulation.edges
  )

  // Force simulation loop
  useFrame(() => {
    if (!stableRef.current) {
      const justStabilized = simulation.tick()
      if (justStabilized) {
        stableRef.current = true
        onStableChange(true)
      }
    }
  })

  const handleNodeClick = useCallback((node: SimNode) => {
    onNodeClick(node)
  }, [onNodeClick])

  const handleNodeHover = useCallback((node: SimNode | null) => {
    if (node) {
      setHoveredNodeId(node.id)
      onNodeHover(node)
    } else {
      setHoveredNodeId(null)
      onNodeHover(null)
    }
  }, [onNodeHover])

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 50, 50]} intensity={0.8} />
      <directionalLight position={[-50, -50, -50]} intensity={0.3} />

      {/* Nodes */}
      <GraphNodes
        nodes={simulation.nodes}
        depthMap={selectedNodeId ? depthMap : new Map()}
        hoveredNodeId={hoveredNodeId}
        selectedNodeId={selectedNodeId}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
      />

      {/* Edges */}
      <GraphEdges
        nodes={simulation.nodes}
        edges={simulation.edges}
        depthMap={selectedNodeId ? depthMap : new Map()}
        hasSelection={selectedNodeId !== null}
      />

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        minDistance={5}
        maxDistance={200}
        enableDamping
        dampingFactor={0.1}
        autoRotate
        autoRotateSpeed={0.3}
        autoRotateDelay={3000}
      />
    </>
  )
}
```

Wait — `useFrame` can only be used inside a `<Canvas>`. Let me restructure. The `Canvas` must wrap `SceneContent` which uses `useFrame`.

- [ ] **Step 1 (revised): Create `GraphScene.tsx`**

```typescript
import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { SynapseNodeData, SynapseEdgeData } from '../../hooks/useSynapse'
import type { SimNode } from './ForceSimulation'
import { ForceSimulation } from './ForceSimulation'
import { computeDepthMap } from './depthMap'
import { GraphNodes } from './GraphNodes'
import { GraphEdges } from './GraphEdges'

interface GraphSceneProps {
  nodes: SynapseNodeData[]
  edges: SynapseEdgeData[]
  viewMode: 'file' | 'symbol'
  selectedNodeId: string | null
  nodeFilters: Set<string>
  edgeFilters: Set<string>
  onNodeClick: (node: SynapseNodeData) => void
  onNodeHover: (node: SynapseNodeData | null) => void
  onStableChange: (stable: boolean) => void
}

function SceneContent({
  simulation,
  selectedNodeId,
  onNodeClick,
  onNodeHover,
  onStableChange,
}: {
  simulation: ForceSimulation
  selectedNodeId: string | null
  onNodeClick: (node: SimNode) => void
  onNodeHover: (node: SimNode | null) => void
  onStableChange: (stable: boolean) => void
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const stableRef = useRef(false)

  // Compute depth map for selection visibility
  const depthMap = useMemo(
    () => selectedNodeId ? computeDepthMap(selectedNodeId, simulation.edges) : new Map<string, number>(),
    [selectedNodeId, simulation.edges]
  )

  // Force simulation loop — run tick each frame until stable
  useFrame(() => {
    if (!stableRef.current) {
      const justStabilized = simulation.tick()
      if (justStabilized) {
        stableRef.current = true
        onStableChange(true)
      }
    }
  })

  const handleNodeClick = useCallback((node: SimNode) => {
    // Convert SimNode back to SynapseNodeData for the parent
    onNodeClick(node as unknown as SynapseNodeData)
  }, [onNodeClick])

  const handleNodeHover = useCallback((node: SimNode | null) => {
    if (node) {
      setHoveredNodeId(node.id)
      onNodeHover(node as unknown as SynapseNodeData)
    } else {
      setHoveredNodeId(null)
      onNodeHover(null)
    }
  }, [onNodeHover])

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 50, 50]} intensity={0.8} />
      <directionalLight position={[-50, -50, -50]} intensity={0.3} />

      <GraphNodes
        nodes={simulation.nodes}
        depthMap={depthMap}
        hoveredNodeId={hoveredNodeId}
        selectedNodeId={selectedNodeId}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
      />

      <GraphEdges
        nodes={simulation.nodes}
        edges={simulation.edges}
        depthMap={depthMap}
        hasSelection={selectedNodeId !== null}
      />

      <OrbitControls
        makeDefault
        minDistance={5}
        maxDistance={200}
        enableDamping
        dampingFactor={0.1}
        autoRotate
        autoRotateSpeed={0.3}
        autoRotateDelay={3000}
      />
    </>
  )
}

export function GraphScene({
  nodes,
  edges,
  viewMode,
  selectedNodeId,
  nodeFilters,
  edgeFilters,
  onNodeClick,
  onNodeHover,
  onStableChange,
}: GraphSceneProps) {
  const simulationRef = useRef<ForceSimulation>(new ForceSimulation())

  // Load/reload simulation when data or filters change
  useEffect(() => {
    simulationRef.current = new ForceSimulation()
    simulationRef.current.load(nodes, edges, viewMode, nodeFilters, edgeFilters)
  }, [nodes, edges, viewMode, nodeFilters, edgeFilters])

  return (
    <Canvas
      className="synapse-3d-canvas"
      camera={{ position: [0, 0, 80], fov: 60, near: 0.1, far: 500 }}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => {
        gl.setClearColor('#0d1117', 1)
      }}
    >
      <SceneContent
        simulation={simulationRef.current}
        selectedNodeId={selectedNodeId}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        onStableChange={onStableChange}
      />
    </Canvas>
  )
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /c/Users/abhir/Desktop/claude && npx tsc --noEmit src/components/synapse/GraphScene.tsx 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/synapse/GraphScene.tsx
git commit -m "feat(synapse): add R3F graph scene with force simulation loop and orbit controls"
```

---

### Task 7: Rewrite SynapseGraph.tsx (Main Component)

**Files:**
- Rewrite: `src/components/synapse/SynapseGraph.tsx`

This task replaces the Sigma.js-based SynapseGraph with the R3F-based version, composing all the sub-components.

- [ ] **Step 1: Rewrite `SynapseGraph.tsx`**

```typescript
import { useState, useCallback } from 'react'
import type { SynapseNodeData, SynapseEdgeData } from '../../hooks/useSynapse'
import { GraphScene } from './GraphScene'
import { OptimizingIndicator } from './OptimizingIndicator'

interface SynapseGraphProps {
  nodes: SynapseNodeData[]
  edges: SynapseEdgeData[]
  selectedNodeId: string | null
  viewMode: 'file' | 'symbol'
  onNodeClick: (node: SynapseNodeData) => void
  onNodeHover: (node: SynapseNodeData | null) => void
  nodeFilters: Set<string>
  edgeFilters: Set<string>
}

export function SynapseGraph({
  nodes,
  edges,
  selectedNodeId,
  viewMode,
  onNodeClick,
  onNodeHover,
  nodeFilters,
  edgeFilters,
}: SynapseGraphProps) {
  const [isStable, setIsStable] = useState(false)

  const handleStableChange = useCallback((stable: boolean) => {
    setIsStable(stable)
  }, [])

  const handleNodeClick = useCallback((node: SynapseNodeData) => {
    onNodeClick(node)
  }, [onNodeClick])

  const handleNodeHover = useCallback((node: SynapseNodeData | null) => {
    onNodeHover(node)
  }, [onNodeHover])

  if (nodes.length === 0) return null

  return (
    <div className="synapse-graph-wrapper" style={{ position: 'relative' }}>
      <GraphScene
        nodes={nodes}
        edges={edges}
        viewMode={viewMode}
        selectedNodeId={selectedNodeId}
        nodeFilters={nodeFilters}
        edgeFilters={edgeFilters}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onStableChange={handleStableChange}
      />
      <OptimizingIndicator visible={!isStable} />
    </div>
  )
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /c/Users/abhir/Desktop/claude && npx vite build 2>&1 | tail -20`
Expected: Build succeeds (may have warnings but no errors)

- [ ] **Step 3: Commit**

```bash
git add src/components/synapse/SynapseGraph.tsx
git commit -m "feat(synapse): rewrite SynapseGraph with React Three Fiber 3D visualization"
```

---

### Task 8: Remove Sigma.js Dependencies

**Files:**
- Modify: `package.json` (remove sigma, graphology-layout-forceatlas2, graphology-layout-noverlap, @sigma/edge-curve)
- Modify: `src/styles/synapse.css` (remove `.synapse-graph` class if still present)

This task removes the now-unused 2D graph dependencies.

- [ ] **Step 1: Uninstall Sigma.js packages**

Run:
```bash
cd /c/Users/abhir/Desktop/claude && npm uninstall sigma graphology-layout-forceatlas2 graphology-layout-noverlap @sigma/edge-curve
```

Keep `graphology` as it may be used by other parts of the codebase. Check:

Run: `cd /c/Users/abhir/Desktop/claude && grep -r "graphology" src/ --include="*.ts" --include="*.tsx" -l`
Expected: No files should reference `graphology` (SynapseGraph.tsx was rewritten without it). If any other files reference it, keep `graphology` in package.json.

- [ ] **Step 2: Verify the build still works after removal**

Run: `cd /c/Users/abhir/Desktop/claude && npx vite build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(synapse): remove Sigma.js and Graphology layout dependencies"
```

---

### Task 9: Visual Testing and Polish

**Files:**
- Potentially modify: `src/components/synapse/GraphNodes.tsx`, `src/components/synapse/GraphEdges.tsx`, `src/components/synapse/GraphScene.tsx`, `src/styles/synapse.css`

This task is for manual visual testing and any polish needed.

- [ ] **Step 1: Start dev server and verify the 3D graph loads**

Run: `cd /c/Users/abhir/Desktop/claude && npm run dev`

Open browser to the app, navigate to Synapse tab, verify:
- 3D graph renders with GitHub-dark background (#0d1117)
- Nodes appear as colored spheres
- Edges appear as colored lines with directional cones
- Auto-rotation works when idle
- Clicking a node dims distant nodes (depth-based visibility)
- "Optimizing layout..." indicator shows and then disappears
- Hover shows node name/path tooltip
- View mode toggle (file/symbol) works
- Node/edge filters work
- Orbit controls (drag, zoom, pan) work

- [ ] **Step 2: Fix any visual issues found during testing**

Common adjustments:
- Camera position/FOV may need tuning for the initial view
- Force simulation parameters (charge, spring, centering) may need tweaking for good layout
- Sphere sizes may need adjustment
- Edge opacity range may need tuning
- Arrow cone size may need scaling

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(synapse): polish 3D graph visual parameters after testing"
```

---

## Self-Review

**1. Spec coverage:**
- GitHub-dark color scheme → Task 1 (NODE_COLORS, EDGE_COLORS), Task 4 (GraphNodes), Task 5 (GraphEdges)
- 3D spheres for nodes → Task 4 (GraphNodes with InstancedMesh)
- Colored edges with arrows → Task 5 (GraphEdges with line segments + cones)
- Force simulation → Task 1 (ForceSimulation class)
- Depth-based selection visibility → Task 2 (depthMap.ts), Task 4 (GraphNodes), Task 5 (GraphEdges)
- Optimizing indicator → Task 3 (OptimizingIndicator)
- OrbitControls with auto-rotation → Task 6 (GraphScene)
- Camera zoom-to-selected → NOT covered (spec mentions it but this is an MVP — can add later)
- Remove Sigma.js → Task 8

**2. Placeholder scan:** No TBDs, TODOs, or "implement later" markers. All code blocks are complete.

**3. Type consistency:** `SimNode` type defined in Task 1, used consistently in Tasks 4, 5, 6. `ForceSimulation.load()` accepts `SynapseNodeData[]`, `SynapseEdgeData[]`, viewMode, nodeFilters, edgeFilters — matches what `SynapseGraph` passes. `SynapseNodeData` imported from `useSynapse` throughout.

One gap: Camera "zoom to selected" was in the spec but not in a task. Adding it would require camera animation logic in R3F which adds complexity — deferring as MVP polish. The OrbitControls auto-rotation and manual zoom cover the core interaction.