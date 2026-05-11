# SYNAPSE 3D Graph Visualization Design

> Converts the 2D Sigma.js graph to a 3D interactive force graph using React Three Fiber.

**Goal:** Replace the flat Sigma.js visualization with an immersive 3D force-directed graph that uses GitHub-dark colors, colored edges, depth-based selection dimming, and a layout stabilization indicator.

**Scope:** Frontend only — replaces `SynapseGraph.tsx` and its CSS. Backend, `useSynapse` hook, and other Synapse components unchanged.

---

## Architecture

**Library:** React Three Fiber (`@react-three/fiber`) + Drei helpers (`@react-three/drei`). Both already installed.

**Graph data flow:**
1. `useSynapse` hook provides `nodes`, `edges`, `selectedNode`, `viewMode`, filters (unchanged)
2. `SynapseGraph` builds a `3d-force-graph`-style simulation using Three.js directly
3. Force simulation runs in `useEffect` — positions stabilize over ~150 iterations (max 300)
4. During stabilization, an "Optimizing..." indicator shows at the bottom
5. Camera auto-rotates gently when idle; user drag/zoom pauses rotation

**No Sigma.js or Graphology layout dependencies** — force simulation is custom via Three.js vectors.

---

## Color Scheme — GitHub Dark

All colors derived from the GitHub Dark theme palette.

### Node Colors (3D spheres)

| Kind       | Hex       | Usage                     |
|------------|-----------|---------------------------|
| File       | `#58a6ff` | Blue — files              |
| Folder     | `#8b949e` | Gray — directories        |
| Function   | `#3fb950` | Green — functions         |
| Class      | `#d29922` | Yellow — classes          |
| Interface  | `#bc8cff` | Purple — interfaces       |
| Method     | `#f0883e` | Orange — methods          |
| Variable   | `#f778ba` | Pink — variables          |

### Edge Colors (3D lines)

| Type        | Hex       | Style        |
|-------------|-----------|--------------|
| IMPORTS     | `#58a6ff` | Blue         |
| CALLS       | `#bc8cff` | Purple       |
| EXTENDS     | `#d29922` | Yellow        |
| IMPLEMENTS  | `#f778ba` | Pink         |
| CONTAINS    | `#3fb950` | Green        |
| DEPENDS_ON  | `#8b949e` | Gray         |
| HAS_METHOD  | `#f0883e` | Orange       |
| HAS_PROPERTY| `#484f58` | Dark gray    |

### Background

`#0d1117` — GitHub Dark canvas background.

---

## 3D Node Rendering

Each node is a **sphere** (Three.js `SphereGeometry`). Properties:

- **Base radius:** 0.3 for files/folders, 0.25 for symbols
- **Radius scales with degree:** `baseRadius + degree * 0.05`, capped at 0.8
- **Material:** `MeshStandardMaterial` with `emissive` set to 30% of the node color for a subtle glow
- **Label:** Drei `<Html>` overlay on hover, showing `name` and `filePath`
- **Sprite labels:** Drei `<Text>` for node names, visible at close zoom only (fade beyond distance 15)

---

## 3D Edge Rendering

Each edge is a **line** between source and target node positions. Properties:

- **Geometry:** `BufferGeometry` with two points (source/target positions)
- **Material:** `LineBasicMaterial` with the edge type color, `opacity: 0.6`, `transparent: true`
- **Arrows:** Small cone mesh at the midpoint, oriented along the edge direction, colored same as the edge
- **Edge width:** Not customizable via `LineBasicMaterial` (WebGL limitation). Use opacity to differentiate confidence — higher confidence = higher opacity (0.3–0.8 range, mapped from confidence 0–1)

---

## Force Simulation

Custom force-directed layout using Three.js `Vector3`:

### Forces

1. **Repulsion** (Coulomb): Every node pair repels. Force = `charge / distance²`, charge = `-300`
2. **Attraction** (Spring): Connected nodes attract. Force = `distance * springStrength`, springStrength = `0.01`
3. **Centering**: Gentle pull toward origin. Force = `position * -0.005`
4. **Z-axis separation**: Slight vertical spread so graph isn't flat. `z = nodeIndex * 0.1`

### Iteration

- Run in `requestAnimationFrame` loop
- Each frame: apply forces, update positions, re-render
- **Damping:** velocity *= 0.85 per frame
- **Stabilization detection:** track total kinetic energy (sum of `velocity.length²`). When below threshold (0.01), mark stable
- **Max iterations:** 300 frames, then force-stable

### Initial positions

Random within a sphere of radius 50 centered at origin. This avoids the "everything at center" problem that plagues random initialization.

---

## Depth-Based Selection Visibility

When a node is selected, all nodes get their opacity/emissive adjusted based on their **shortest path distance** from the selected node (BFS on the filtered graph):

| Depth | Label           | Opacity | Emissive Intensity | Visual              |
|-------|-----------------|---------|--------------------|----------------------|
| 0     | Selected node   | 1.0     | 1.0 (full glow)   | Bright, fully lit    |
| 1     | Direct neighbor | 0.7     | 0.5                | Visible, reduced    |
| 2     | 2 hops away     | 0.35    | 0.2                | Dull, faded         |
| 3+    | Far away        | 0.1     | 0.0                | Nearly invisible     |

Edges follow the same pattern — edges connecting nodes at depth 0–1 are full opacity, edges at depth 2 are 0.3, depth 3+ are 0.05.

**No selection** = all nodes at opacity 0.85, emissive 0.3 (default lit state).

### Implementation

- Compute depth map via BFS when `selectedNodeId` changes
- Store as `Map<nodeId, depth>` in component state
- Pass to node/edge renderers as props
- Animate opacity transitions with per-frame interpolation in the render loop (lerp toward target opacity each frame)

---

## Optimizing Indicator

While the force simulation is iterating and has not yet stabilized:

- Show a small banner at the **bottom center** of the graph container
- Text: "Optimizing layout..." with a subtle pulsing dot animation
- Banner style: semi-transparent dark background (`rgba(13, 17, 23, 0.8)`), GitHub-dark border (`#30363d`), text in `#8b949e`
- Disappears when simulation reaches stable state (kinetic energy below threshold)
- Reappears briefly when filters/viewMode change (forces re-simulate)

### CSS

```css
.synapse-3d-optimizing {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(13, 17, 23, 0.8);
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 6px 14px;
  color: #8b949e;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.3s;
}
.synapse-3d-optimizing__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #58a6ff;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
```

---

## Camera & Controls

- **OrbitControls** from Drei — drag to rotate, scroll to zoom, right-click to pan
- **Auto-rotation:** Gentle Y-axis rotation (0.1 rad/s) when user is idle (no interaction for 3s). Pause on any mouse event.
- **Zoom to selected:** When a node is clicked, smoothly animate camera to position 5 units away from the selected node, looking at it.
- **Min/max distance:** 5 to 200

---

## File Changes

| File                     | Action   | Description                                        |
|--------------------------|----------|----------------------------------------------------|
| `src/components/synapse/SynapseGraph.tsx` | Rewrite | Replace Sigma.js with R3F 3D scene                |
| `src/styles/synapse.css`          | Modify  | Add 3D container styles, optimizing indicator, remove Sigma-specific styles |
| `package.json`                    | Modify  | Remove `sigma`, `graphology-layout-forceatlas2`, `graphology-layout-noverlap` (keep `graphology` if used elsewhere, otherwise remove) |

**No backend changes.** The `useSynapse` hook is unchanged. `SynapsePage`, `SynapseToolbar`, `SynapsePanel`, `SynapseProgress` are unchanged.

---

## Performance Considerations

- **Instanced meshes** for nodes if count > 200 (use `InstancedMesh` with shared geometry)
- **Edge culling:** Don't render edges for nodes outside camera frustum
- **Label culling:** Hide `Html` labels when camera distance > 20
- **Force simulation:** Stop updating positions after stabilization (freeze velocities)
- **Debounced BFS:** Depth map computation debounced by 100ms when `selectedNodeId` changes rapidly