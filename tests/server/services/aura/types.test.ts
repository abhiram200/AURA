import { describe, it, expect } from 'vitest'
import {
  AuraNodeKind,
  AuraEdgeType,
} from '@server/services/aura/types.ts'
import type {
  AuraNode,
  AuraEdge,
  GraphData,
  IndexingStatus,
} from '@server/services/aura/types.ts'

describe('AuraNodeKind', () => {
  it('has all 7 expected values', () => {
    const expected = [
      'File',
      'Folder',
      'Function',
      'Class',
      'Interface',
      'Method',
      'Variable',
    ] as const

    expect(Object.values(AuraNodeKind)).toHaveLength(expected.length)

    for (const value of expected) {
      expect(AuraNodeKind[value as keyof typeof AuraNodeKind]).toBe(value)
    }
  })
})

describe('AuraEdgeType', () => {
  it('has all 8 expected values', () => {
    const expected = [
      'CONTAINS',
      'IMPORTS',
      'CALLS',
      'EXTENDS',
      'IMPLEMENTS',
      'HAS_METHOD',
      'HAS_PROPERTY',
      'DEPENDS_ON',
    ] as const

    expect(Object.values(AuraEdgeType)).toHaveLength(expected.length)

    for (const value of expected) {
      expect(AuraEdgeType[value as keyof typeof AuraEdgeType]).toBe(value)
    }
  })
})

describe('AuraNode', () => {
  it('is constructable with correct types', () => {
    const node: AuraNode = {
      id: 'src/hooks/useChat:useChat',
      kind: AuraNodeKind.Function,
      name: 'useChat',
      filePath: 'src/hooks/useChat.ts',
      range: { startLine: 1, endLine: 50 },
      exported: true,
    }

    expect(node.id).toBe('src/hooks/useChat:useChat')
    expect(node.kind).toBe(AuraNodeKind.Function)
    expect(node.name).toBe('useChat')
    expect(node.filePath).toBe('src/hooks/useChat.ts')
    expect(node.range?.startLine).toBe(1)
    expect(node.range?.endLine).toBe(50)
    expect(node.exported).toBe(true)
    expect(node.metadata).toBeUndefined()
  })

  it('allows optional range and metadata', () => {
    const node: AuraNode = {
      id: 'src/index.ts',
      kind: AuraNodeKind.File,
      name: 'index.ts',
      filePath: 'src/index.ts',
      exported: false,
      metadata: { size: 1024 },
    }

    expect(node.range).toBeUndefined()
    expect(node.metadata).toEqual({ size: 1024 })
  })
})

describe('AuraEdge', () => {
  it('is constructable with correct types', () => {
    const edge: AuraEdge = {
      source: 'src/hooks/useChat:useChat',
      target: 'src/services/api:fetchData',
      type: AuraEdgeType.CALLS,
      confidence: 0.95,
    }

    expect(edge.source).toBe('src/hooks/useChat:useChat')
    expect(edge.target).toBe('src/services/api:fetchData')
    expect(edge.type).toBe(AuraEdgeType.CALLS)
    expect(edge.confidence).toBe(0.95)
    expect(edge.metadata).toBeUndefined()
  })

  it('allows optional metadata', () => {
    const edge: AuraEdge = {
      source: 'src/App.tsx',
      target: 'src/components/Chat.tsx',
      type: AuraEdgeType.IMPORTS,
      confidence: 1.0,
      metadata: { importName: 'ChatLayout' },
    }

    expect(edge.metadata).toEqual({ importName: 'ChatLayout' })
  })
})

describe('GraphData', () => {
  it('composes nodes and edges', () => {
    const nodes: AuraNode[] = [
      {
        id: 'src/App.tsx',
        kind: AuraNodeKind.File,
        name: 'App.tsx',
        filePath: 'src/App.tsx',
        exported: true,
      },
      {
        id: 'src/hooks/useChat:useChat',
        kind: AuraNodeKind.Function,
        name: 'useChat',
        filePath: 'src/hooks/useChat.ts',
        exported: true,
      },
    ]

    const edges: AuraEdge[] = [
      {
        source: 'src/App.tsx',
        target: 'src/hooks/useChat:useChat',
        type: AuraEdgeType.IMPORTS,
        confidence: 1.0,
      },
    ]

    const graph: GraphData = { nodes, edges }

    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(graph.nodes[0].kind).toBe(AuraNodeKind.File)
    expect(graph.edges[0].type).toBe(AuraEdgeType.IMPORTS)
  })
})

describe('IndexingStatus', () => {
  it('tracks pipeline state', () => {
    const status: IndexingStatus = {
      phase: 'parsing',
      progress: 0.5,
      filesProcessed: 25,
      totalFiles: 50,
      nodesFound: 120,
      edgesFound: 80,
      message: 'Parsing files...',
    }

    expect(status.phase).toBe('parsing')
    expect(status.progress).toBe(0.5)
    expect(status.filesProcessed).toBe(25)
    expect(status.totalFiles).toBe(50)
    expect(status.nodesFound).toBe(120)
    expect(status.edgesFound).toBe(80)
    expect(status.message).toBe('Parsing files...')
    expect(status.error).toBeUndefined()
  })

  it('supports error phase', () => {
    const status: IndexingStatus = {
      phase: 'error',
      progress: 0,
      filesProcessed: 0,
      totalFiles: 0,
      nodesFound: 0,
      edgesFound: 0,
      message: 'Indexing failed',
      error: 'ENOENT: no such file or directory',
    }

    expect(status.phase).toBe('error')
    expect(status.error).toBe('ENOENT: no such file or directory')
  })
})