import { useRef, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { SimNode } from './ForceSimulation'
import { getDepthAppearance } from './depthMap'

interface GraphNodesProps {
  nodes: Map<string, SimNode>
  depthMap: Map<string, number>
  hoveredNodeId: string | null
  selectedNodeId: string | null
  onNodeClick: (node: SimNode) => void
  onNodeHover: (node: SimNode | null) => void
  viewMode: 'file' | 'symbol' | 'hybrid'
  isLightMode?: boolean
}

const dummy = new THREE.Object3D()
const sphereGeometry = new THREE.SphereGeometry(1, 16, 12)
sphereGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000)
const tempColor = new THREE.Color()
const hiddenColor = new THREE.Color('#000000')

export function GraphNodes({
  nodes,
  depthMap,
  hoveredNodeId,
  selectedNodeId,
  onNodeClick,
  onNodeHover,
  viewMode,
  isLightMode = false,
}: GraphNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)

  const nodeArray = useMemo(() => Array.from(nodes.values()), [nodes])
  const hasSelection = selectedNodeId !== null

  const { camera } = useThree()

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const count = nodeArray.length
    const cameraPos = camera.position

    for (let i = 0; i < count; i++) {
      const node = nodeArray[i]

      dummy.position.set(node.x, node.y, node.z)

      // LOD culling: hide nodes that are too small on screen
      const dist = cameraPos.distanceTo(dummy.position)
      const screenSize = node.baseRadius / dist * 100
      if (screenSize < 0.5) {
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        // Set color to transparent/hidden
        mesh.setColorAt(i, hiddenColor)
        continue
      }

      dummy.scale.setScalar(node.baseRadius)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      tempColor.set(node.color)
      const depth = depthMap.get(node.id)
      const appearance = getDepthAppearance(depth, hasSelection)

      tempColor.multiplyScalar(appearance.brightness)
      if (isLightMode) tempColor.multiplyScalar(0.55)
      mesh.setColorAt(i, tempColor)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  const handlePointerDown = (event: ThreeEvent) => {
    if (event.instanceId !== undefined && event.instanceId !== null) {
      const node = nodeArray[event.instanceId]
      if (node) {
        onNodeClick(node)
      }
    }
  }

  const handlePointerMove = (event: ThreeEvent) => {
    if (event.instanceId !== undefined && event.instanceId !== null) {
      const node = nodeArray[event.instanceId]
      if (node && node.id !== hoveredNodeId) {
        setHoveredNode(node)
        onNodeHover(node)
      }
    } else {
      if (hoveredNode) {
        setHoveredNode(null)
        onNodeHover(null)
      }
    }
  }

  const handlePointerLeave = () => {
    if (hoveredNode) {
      setHoveredNode(null)
      onNodeHover(null)
    }
  }

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[sphereGeometry, undefined, Math.max(nodeArray.length, 1)]}
        frustumCulled={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <meshStandardMaterial
          vertexColors
          emissive={isLightMode ? '#333333' : '#8b949e'}
          emissiveIntensity={0.3}
          roughness={0.5}
          metalness={0.15}
        />
      </instancedMesh>

      {hoveredNode && (
        <Html
          position={[hoveredNode.x, hoveredNode.y + hoveredNode.baseRadius + 0.5, hoveredNode.z]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              background: isLightMode ? 'rgba(255, 255, 255, 0.95)' : 'rgba(13, 17, 23, 0.95)',
              border: `1px solid ${isLightMode ? '#d0d0d0' : '#30363d'}`,
              borderRadius: 8,
              padding: '8px 14px',
              color: isLightMode ? '#1a1a2e' : '#c9d1d9',
              fontSize: 14,
              fontFamily: "'Fira Code', 'Cascadia Code', monospace",
              whiteSpace: 'nowrap',
              boxShadow: isLightMode ? '0 4px 12px rgba(0,0,0,0.15)' : '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>{hoveredNode.name}</div>
            <div style={{ fontSize: 12, color: isLightMode ? '#666' : '#8b949e', marginTop: 2 }}>{hoveredNode.filePath}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

interface ThreeEvent {
  instanceId?: number | null
  point: THREE.Vector3
  object: THREE.Object3D
}