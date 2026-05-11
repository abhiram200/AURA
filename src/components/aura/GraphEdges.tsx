import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimNode, SimEdge } from './ForceSimulation'
import { EDGE_COLORS } from './ForceSimulation'
import { getEdgeOpacity } from './depthMap'

interface GraphEdgesProps {
  nodes: Map<string, SimNode>
  edges: SimEdge[]
  depthMap: Map<string, number>
  hasSelection: boolean
  isLightMode?: boolean
}

const coneGeometry = new THREE.ConeGeometry(0.25, 0.6, 6)

export default function GraphEdges({ nodes, edges, depthMap, hasSelection, isLightMode = false }: GraphEdgesProps) {
  const groupRef = useRef<THREE.Group>(null)

  // Pre-filter valid edges
  const validEdges = useMemo(
    () => edges.filter(e => nodes.has(e.source) && nodes.has(e.target)),
    [edges, nodes],
  )

  // Compute per-edge colors and opacities
  const edgeAppearance = useMemo(() => {
    return validEdges.map(edge => {
      const colorHex = EDGE_COLORS[edge.type] ?? '#8b949e'
      const sourceDepth = depthMap.get(edge.source)
      const targetDepth = depthMap.get(edge.target)
      const opacity = hasSelection ? getEdgeOpacity(sourceDepth, targetDepth) : 0.85
      // In light mode, darken edge colors for contrast on light background
      const finalColor = isLightMode
        ? '#' + new THREE.Color(colorHex).multiplyScalar(0.6).getHexString()
        : colorHex
      return { colorHex: finalColor, opacity }
    })
  }, [validEdges, depthMap, hasSelection, isLightMode])

  // Create line buffer geometry
  const lineGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(validEdges.length * 6)
    const colors = new Float32Array(validEdges.length * 6)

    for (let i = 0; i < validEdges.length; i++) {
      const edge = validEdges[i]
      const source = nodes.get(edge.source)!
      const target = nodes.get(edge.target)!
      const { colorHex, opacity } = edgeAppearance[i]
      const color = new THREE.Color(colorHex).multiplyScalar(opacity)

      positions[i * 6] = source.x
      positions[i * 6 + 1] = source.y
      positions[i * 6 + 2] = source.z
      positions[i * 6 + 3] = target.x
      positions[i * 6 + 4] = target.y
      positions[i * 6 + 5] = target.z

      colors[i * 6] = color.r
      colors[i * 6 + 1] = color.g
      colors[i * 6 + 2] = color.b
      colors[i * 6 + 3] = color.r
      colors[i * 6 + 4] = color.g
      colors[i * 6 + 5] = color.b
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return geo
  }, [validEdges, nodes, edgeAppearance])

  // Update positions every frame during simulation
  useFrame(() => {
    const positions = lineGeometry.getAttribute('position') as THREE.BufferAttribute
    if (!positions) return

    for (let i = 0; i < validEdges.length; i++) {
      const edge = validEdges[i]
      const source = nodes.get(edge.source)
      const target = nodes.get(edge.target)
      if (!source || !target) continue

      positions.setXYZ(i * 2, source.x, source.y, source.z)
      positions.setXYZ(i * 2 + 1, target.x, target.y, target.z)
    }
    positions.needsUpdate = true

    // Update arrow positions
    if (!groupRef.current) return
    const arrows = groupRef.current.children
    for (let i = 0; i < arrows.length && i < validEdges.length; i++) {
      const edge = validEdges[i]
      const source = nodes.get(edge.source)
      const target = nodes.get(edge.target)
      if (!source || !target) continue

      arrows[i].position.set(
        (source.x + target.x) / 2,
        (source.y + target.y) / 2,
        (source.z + target.z) / 2,
      )
    }
  })

  // Compute arrow data
  const arrowData = useMemo(() => {
    return validEdges.map((edge, i) => {
      const source = nodes.get(edge.source)!
      const target = nodes.get(edge.target)!
      const direction = new THREE.Vector3(
        target.x - source.x,
        target.y - source.y,
        target.z - source.z,
      )
      const quaternion = new THREE.Quaternion()
      if (direction.lengthSq() > 0) {
        direction.normalize()
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
      }
      return { quaternion, ...edgeAppearance[i] }
    })
  }, [validEdges, nodes, edgeAppearance])

  if (validEdges.length === 0) return null

  return (
    <>
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} linewidth={2} />
      </lineSegments>
      <group ref={groupRef}>
        {arrowData.map((arrow, i) => (
          <mesh
            key={i}
            geometry={coneGeometry}
            position={[0, 0, 0]}
            quaternion={[arrow.quaternion.x, arrow.quaternion.y, arrow.quaternion.z, arrow.quaternion.w]}
          >
            <meshStandardMaterial
              color={arrow.colorHex}
              transparent
              opacity={arrow.opacity}
              emissive={arrow.colorHex}
              emissiveIntensity={0.4}
            />
          </mesh>
        ))}
      </group>
    </>
  )
}