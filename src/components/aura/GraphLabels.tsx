import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimNode } from './ForceSimulation'
import { getDepthAppearance } from './depthMap'

// ── Constants ──────────────────────────────────────────────────────────────────

const CANVAS_W = 512
const CANVAS_H = 128
const SPRITE_SCALE_X = 7
const SPRITE_SCALE_Y = 1.75
const LABEL_Y_OFFSET = 1.2
const MIN_SCREEN_SIZE = 0.8

// ── Texture cache (keyed by name|color) ─────────────────────────────────────────

const textureCache = new Map<string, THREE.CanvasTexture>()

function createLabelTexture(name: string, color: string): THREE.CanvasTexture {
  const key = `${name}|${color}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')!
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas)
    textureCache.set(key, fallback)
    return fallback
  }

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  // Rounded rect background — opaque dark
  const pad = 6
  const r = 14
  ctx.fillStyle = 'rgba(1, 4, 9, 0.94)'
  ctx.beginPath()
  ctx.moveTo(pad + r, pad)
  ctx.lineTo(CANVAS_W - pad - r, pad)
  ctx.quadraticCurveTo(CANVAS_W - pad, pad, CANVAS_W - pad, pad + r)
  ctx.lineTo(CANVAS_W - pad, CANVAS_H - pad - r)
  ctx.quadraticCurveTo(CANVAS_W - pad, CANVAS_H - pad, CANVAS_W - pad - r, CANVAS_H - pad)
  ctx.lineTo(pad + r, CANVAS_H - pad)
  ctx.quadraticCurveTo(pad, CANVAS_H - pad, pad, CANVAS_H - pad - r)
  ctx.lineTo(pad, pad + r)
  ctx.quadraticCurveTo(pad, pad, pad + r, pad)
  ctx.closePath()
  ctx.fill()

  // Bright border
  ctx.strokeStyle = 'rgba(139, 148, 158, 0.7)'
  ctx.lineWidth = 3
  ctx.stroke()

  // Color accent dot — larger
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(pad + r + 16, CANVAS_H / 2, 12, 0, Math.PI * 2)
  ctx.fill()

  // White glow ring around dot
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Text — bright white, large
  ctx.fillStyle = '#f0f6fc'
  ctx.font = 'bold 42px "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  // Subtle text shadow for readability
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1

  const textX = pad + r + 36
  const maxTextWidth = CANVAS_W - textX - pad - r

  let displayName = name
  if (ctx.measureText(displayName).width > maxTextWidth) {
    while (displayName.length > 1 && ctx.measureText(displayName + '...').width > maxTextWidth) {
      displayName = displayName.slice(0, -1)
    }
    displayName += '...'
  }

  ctx.fillText(displayName, textX, CANVAS_H / 2)

  // Reset shadow
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  textureCache.set(key, texture)
  return texture
}

// ── Component ──────────────────────────────────────────────────────────────────

interface GraphLabelsProps {
  nodes: Map<string, SimNode>
  depthMap: Map<string, number>
  selectedNodeId: string | null
}

export function GraphLabels({ nodes, depthMap, selectedNodeId }: GraphLabelsProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const hasSelection = selectedNodeId !== null

  const nodeArray = useMemo(() => Array.from(nodes.values()), [nodes])

  // Create sprites when the node set changes
  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    // Dispose old sprites (textures are cached, not disposed here)
    for (const child of group.children) {
      if (child instanceof THREE.Sprite) {
        child.material.dispose()
      }
    }
    group.clear()

    const emptyRaycast = () => {}

    for (const node of nodeArray) {
      const texture = createLabelTexture(node.name, node.color)
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
      })
      const sprite = new THREE.Sprite(material)
      sprite.position.set(node.x, node.y + node.baseRadius + LABEL_Y_OFFSET, node.z)
      sprite.scale.set(SPRITE_SCALE_X, SPRITE_SCALE_Y, 1)
      sprite.renderOrder = 2
      sprite.userData = { nodeId: node.id }
      sprite.raycast = emptyRaycast
      group.add(sprite)
    }

    return () => {
      for (const child of group.children) {
        if (child instanceof THREE.Sprite) {
          child.material.dispose()
        }
      }
      group.clear()
    }
  }, [nodeArray])

  // Per-frame: update positions, visibility, and opacity
  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const camPos = camera.position

    for (const child of group.children) {
      if (!(child instanceof THREE.Sprite)) continue

      const nodeId = child.userData.nodeId as string
      const node = nodes.get(nodeId)
      if (!node) {
        child.visible = false
        continue
      }

      // Follow node position
      child.position.set(node.x, node.y + node.baseRadius + LABEL_Y_OFFSET, node.z)

      // LOD culling — hide labels for nodes too small on screen
      const dist = camPos.distanceTo(child.position)
      const screenSize = node.baseRadius / dist * 100
      if (screenSize < MIN_SCREEN_SIZE) {
        child.visible = false
        continue
      }

      child.visible = true

      // Depth-based opacity — labels stay more visible than nodes
      const depth = depthMap.get(nodeId)
      const appearance = getDepthAppearance(depth, hasSelection)
      const material = child.material as THREE.SpriteMaterial

      if (hasSelection) {
        if (depth === undefined) {
          // Unrelated node: show label at reduced but readable opacity
          material.opacity = 0.45
        } else if (depth === 0) {
          // Selected node: full brightness
          material.opacity = 1.0
        } else if (depth === 1) {
          material.opacity = 0.9
        } else if (depth === 2) {
          material.opacity = 0.75
        } else {
          material.opacity = 0.5
        }
      } else {
        // No selection — all labels fully visible
        material.opacity = 1.0
      }
    }
  })

  return <group ref={groupRef} raycast={() => {}} />
}