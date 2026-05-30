import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { AuraNodeData, AuraEdgeData } from '../../hooks/useAura'
import type { SimNode } from './ForceSimulation'
import { ForceSimulation } from './ForceSimulation'
import { computeDepthMap } from './depthMap'
import { GraphNodes } from './GraphNodes'
import GraphEdges from './GraphEdges'
import { GraphLabels } from './GraphLabels'

function ClearColorUpdater({ isLightMode }: { isLightMode: boolean }) {
  const { gl } = useThree()
  useEffect(() => {
    gl.setClearColor(isLightMode ? '#f5f5f5' : '#0d1117', 1)
  }, [gl, isLightMode])
  return null
}

// ── Scroll/Pinch Handler ──────────────────────────────────────────────────────
// ctrlKey wheel events = trackpad pinch → zoom
// non-ctrlKey wheel events = trackpad swipe / mouse scroll → pan through space

function ScrollPan({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()

  useEffect(() => {
    const canvas = document.querySelector('.aura-3d-canvas canvas')
    if (!canvas) return

    const targetVec = new THREE.Vector3()
    const direction = new THREE.Vector3()

    const onWheel = (e: Event) => {
      e.preventDefault()
      const wheelEvent = e as WheelEvent

      if (wheelEvent.ctrlKey) {
        // Pinch zoom — move camera along the target→camera axis so it can never
        // pass through the orbit target and flip direction
        if (controlsRef.current) {
          targetVec.copy(controlsRef.current.target)
        } else {
          targetVec.set(0, 0, 0)
        }

        direction.copy(camera.position).sub(targetVec)
        const currentDist = direction.length()
        if (currentDist < 0.001) {
          // Camera is at the target — nudge it along the camera's back vector
          camera.getWorldDirection(direction).negate()
          direction.normalize()
          camera.position.addScaledVector(direction, 2)
          return
        }

        direction.normalize()
        const zoomSpeed = 0.5
        const delta = wheelEvent.deltaY * zoomSpeed
        const newDist = Math.max(currentDist + delta, 0.5)
        camera.position.copy(targetVec).addScaledVector(direction, newDist)
      } else {
        // Two-finger swipe / scroll → pan in the view plane
        const right = new THREE.Vector3()
        const up = new THREE.Vector3()
        right.setFromMatrixColumn(camera.matrixWorld, 0)
        up.setFromMatrixColumn(camera.matrixWorld, 1)

        const panSpeed = 0.05
        camera.position.addScaledVector(right, -wheelEvent.deltaX * panSpeed)
        camera.position.addScaledVector(up, wheelEvent.deltaY * panSpeed)
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [camera, controlsRef])

  return null
}

// ── Camera Focus on Selected Node ─────────────────────────────────────────────

function computeHomeView(simulation: ForceSimulation): { position: THREE.Vector3; target: THREE.Vector3 } | null {
  if (simulation.nodes.size === 0) return null
  let centerX = 0, centerY = 0, centerZ = 0
  let count = 0

  for (const node of simulation.nodes.values()) {
    centerX += node.x; centerY += node.y; centerZ += node.z
    count++
  }
  centerX /= count; centerY /= count; centerZ /= count

  // Use 90th percentile radius instead of max to avoid outlier nodes zooming out too far
  const radii: number[] = []
  for (const node of simulation.nodes.values()) {
    const dx = node.x - centerX, dy = node.y - centerY, dz = node.z - centerZ
    radii.push(Math.sqrt(dx * dx + dy * dy + dz * dz))
  }
  radii.sort((a, b) => a - b)
  const p90Index = Math.min(Math.ceil(radii.length * 0.9), radii.length - 1)
  const radius = radii[p90Index] || radii[radii.length - 1] || 10

  // Clamp: use at least 10 and at most 200 for the camera distance calculation
  const clampedRadius = Math.max(10, Math.min(radius, 200))
  const dist = clampedRadius / Math.sin(Math.PI / 6) * 0.85

  return {
    position: new THREE.Vector3(centerX, centerY, centerZ + dist),
    target: new THREE.Vector3(centerX, centerY, centerZ),
  }
}

function CameraFocusNode({ selectedNodeId, simulation, controlsRef }: {
  selectedNodeId: string | null
  simulation: ForceSimulation
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}) {
  const { camera } = useThree()
  const targetPosRef = useRef(new THREE.Vector3())
  const targetLookAtRef = useRef(new THREE.Vector3())
  const animatingRef = useRef(false)

  useEffect(() => {
    if (selectedNodeId) {
      // Zoom to selected node
      let node = simulation.nodes.get(selectedNodeId)
      if (!node && selectedNodeId.includes(':')) {
        const filePath = selectedNodeId.substring(0, selectedNodeId.indexOf(':'))
        node = simulation.nodes.get(filePath)
      }
      if (!node) return
      targetPosRef.current.set(node.x, node.y, node.z + 12)
      targetLookAtRef.current.set(node.x, node.y, node.z)
      animatingRef.current = true
    } else {
      // Deselected — zoom back out to full graph view
      const home = computeHomeView(simulation)
      if (!home) return
      targetPosRef.current.copy(home.position)
      targetLookAtRef.current.copy(home.target)
      animatingRef.current = true
    }
  }, [selectedNodeId, simulation])

  useFrame(() => {
    if (!animatingRef.current) return
    camera.position.lerp(targetPosRef.current, 0.08)
    if (controlsRef.current) {
      controlsRef.current.target.lerp(targetLookAtRef.current, 0.08)
    }
    if (camera.position.distanceTo(targetPosRef.current) < 0.1) {
      camera.position.copy(targetPosRef.current)
      if (controlsRef.current) {
        controlsRef.current.target.copy(targetLookAtRef.current)
      }
      animatingRef.current = false
    }
  })

  return null
}

// ── Camera Auto-Fit ──────────────────────────────────────────────────────────

function CameraAutoFit({ simulation, stable, controlsRef }: { simulation: ForceSimulation; stable: boolean; controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()
  const fittedRef = useRef(false)
  const targetPos = useRef(new THREE.Vector3(0, 0, 80))
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0))

  useFrame(() => {
    if (!stable || fittedRef.current) return
    if (simulation.nodes.size === 0) return

    // Compute center of all nodes
    let cx = 0, cy = 0, cz = 0
    let count = 0
    for (const node of simulation.nodes.values()) {
      cx += node.x; cy += node.y; cz += node.z
      count++
    }
    cx /= count; cy /= count; cz /= count

    // Use 90th percentile radius instead of max to avoid outlier nodes zooming out too far
    const radii: number[] = []
    for (const node of simulation.nodes.values()) {
      const dx = node.x - cx, dy = node.y - cy, dz = node.z - cz
      radii.push(Math.sqrt(dx * dx + dy * dy + dz * dz))
    }
    radii.sort((a, b) => a - b)
    const p90Index = Math.min(Math.ceil(radii.length * 0.9), radii.length - 1)
    const radius = radii[p90Index] || radii[radii.length - 1] || 10
    const clampedRadius = Math.max(10, Math.min(radius, 200))

    const dist = clampedRadius / Math.sin(Math.PI / 6) * 0.85

    targetPos.current.set(cx, cy, cz + dist)
    targetLookAt.current.set(cx, cy, cz)

    camera.position.lerp(targetPos.current, 0.1)
    if (controlsRef.current) {
      controlsRef.current.target.lerp(targetLookAt.current, 0.1)
      controlsRef.current.update()
    } else {
      camera.lookAt(targetLookAt.current)
    }
    camera.updateProjectionMatrix()

    if (camera.position.distanceTo(targetPos.current) < 0.5) {
      camera.position.copy(targetPos.current)
      if (controlsRef.current) {
        controlsRef.current.target.copy(targetLookAt.current)
        controlsRef.current.update()
      }
      fittedRef.current = true
    }
  })

  return null
}

// ── SimulationDriver (inside Canvas — drives the sim via useFrame) ───────────

function SimulationDriver({ simulation, onStableChange }: { simulation: ForceSimulation; onStableChange: (stable: boolean) => void }) {
  const stableRef = useRef(false)

  // If the simulation is already stable (e.g. small graph), notify immediately
  if (simulation.stable && !stableRef.current) {
    stableRef.current = true
    // Defer to next frame so React has mounted the Canvas first
    requestAnimationFrame(() => onStableChange(true))
  }

  useFrame(() => {
    if (stableRef.current) return
    if (simulation.stable) {
      stableRef.current = true
      onStableChange(true)
      return
    }
    const isStable = simulation.tick()
    if (isStable) {
      stableRef.current = true
      onStableChange(true)
    }
  })

  return null
}

// ── SceneContent (internal — rendered inside Canvas) ─────────────────────────

interface SceneContentProps {
  simulation: ForceSimulation
  selectedNodeId: string | null
  viewMode: 'file' | 'symbol' | 'hybrid'
  onNodeClick: (node: AuraNodeData | null) => void
  onNodeHover: (node: AuraNodeData | null) => void
  onStableChange: (stable: boolean) => void
  isStable: boolean
  isLightMode: boolean
  lastNodeSelectTimeRef: React.MutableRefObject<number>
}

function SceneContent({
  simulation,
  selectedNodeId,
  viewMode,
  onNodeClick,
  onNodeHover,
  onStableChange,
  isStable,
  isLightMode,
  lastNodeSelectTimeRef,
}: SceneContentProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  const depthMap = useMemo(() => {
    if (selectedNodeId) {
      // In file view mode, the simulation only has file-level nodes.
      // Fall back to the parent file node for depth BFS.
      // In symbol/hybrid modes, symbol nodes exist in the simulation so use them directly.
      const effectiveId = viewMode === 'file' && selectedNodeId.includes(':')
        ? selectedNodeId.substring(0, selectedNodeId.indexOf(':'))
        : selectedNodeId
      return computeDepthMap(effectiveId, simulation.edges)
    }
    return new Map<string, number>()
  }, [selectedNodeId, simulation.edges, viewMode])

  const handleNodeClick = useCallback(
    (node: SimNode) => {
      lastNodeSelectTimeRef.current = Date.now()
      onNodeClick(node as unknown as AuraNodeData)
    },
    [onNodeClick, lastNodeSelectTimeRef],
  )

  const handleNodeHover = useCallback(
    (node: SimNode | null) => {
      if (node !== null) {
        setHoveredNodeId(node.id)
        onNodeHover(node as unknown as AuraNodeData)
      } else {
        setHoveredNodeId(null)
        onNodeHover(null)
      }
    },
    [onNodeHover],
  )

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 50, 50]} intensity={0.8} />
      <directionalLight position={[-50, -50, -50]} intensity={0.3} />

      <SimulationDriver simulation={simulation} onStableChange={onStableChange} />
      <CameraAutoFit simulation={simulation} stable={isStable} controlsRef={controlsRef} />

      <GraphNodes
        nodes={simulation.nodes}
        depthMap={depthMap}
        hoveredNodeId={hoveredNodeId}
        selectedNodeId={selectedNodeId}
        viewMode={viewMode}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        isLightMode={isLightMode}
      />

      <GraphEdges
        nodes={simulation.nodes}
        edges={simulation.edges}
        depthMap={depthMap}
        hasSelection={selectedNodeId !== null}
        isLightMode={isLightMode}
      />

      <GraphLabels
        nodes={simulation.nodes}
        depthMap={depthMap}
        selectedNodeId={selectedNodeId}
      />

      <CameraFocusNode selectedNodeId={selectedNodeId} simulation={simulation} controlsRef={controlsRef} />
      <ScrollPan controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableZoom={false}
        enableDamping
        dampingFactor={0.1}
      />
    </>
  )
}

// ── GraphScene (exported — contains Canvas) ─────────────────────────────────

interface GraphSceneProps {
  nodes: AuraNodeData[]
  edges: AuraEdgeData[]
  viewMode: 'file' | 'symbol' | 'hybrid'
  selectedNodeId: string | null
  nodeFilters: Set<string>
  edgeFilters: Set<string>
  onNodeClick: (node: AuraNodeData | null) => void
  onNodeHover: (node: AuraNodeData | null) => void
  onStableChange: (stable: boolean) => void
  isLightMode?: boolean
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
  isLightMode = false,
}: GraphSceneProps) {
  const simulationRef = useRef<ForceSimulation | null>(null)
  const [canvasKey, setCanvasKey] = useState(0)
  const [isStable, setIsStable] = useState(false)
  const lastNodeSelectTimeRef = useRef(0)

  const handleStableChange = useCallback((stable: boolean) => {
    setIsStable(stable)
    onStableChange(stable)
  }, [onStableChange])

  useEffect(() => {
    const sim = new ForceSimulation()
    sim.load(nodes, edges, viewMode, nodeFilters, edgeFilters)
    simulationRef.current = sim
    setIsStable(false)
    onStableChange(false)
    setCanvasKey((k) => k + 1)
  }, [nodes, edges, viewMode, nodeFilters, edgeFilters]) // intentionally exclude onStableChange

  const handlePointerMissed = useCallback(() => {
    // Skip deselection if a node was just clicked — onPointerMissed can
    // fire in the same frame as a node click due to R3F event ordering
    if (Date.now() - lastNodeSelectTimeRef.current < 300) return
    onNodeClick(null)
  }, [onNodeClick])

  if (!simulationRef.current) return null

  return (
    <Canvas
      key={canvasKey}
      className="aura-3d-canvas"
      camera={{ position: [0, 0, 50], fov: 60, near: 0.01, far: 5000 }}
      gl={{ logarithmicDepthBuffer: true, antialias: true, alpha: false }}
      onPointerMissed={handlePointerMissed}
    >
      <ClearColorUpdater isLightMode={isLightMode} />
      <SceneContent
        simulation={simulationRef.current}
        selectedNodeId={selectedNodeId}
        viewMode={viewMode}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        onStableChange={handleStableChange}
        isStable={isStable}
        isLightMode={isLightMode}
        lastNodeSelectTimeRef={lastNodeSelectTimeRef}
      />
    </Canvas>
  )
}