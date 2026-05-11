import { describe, it, expect } from 'vitest'
import {
  SynapseNodeKind,
  SynapseEdgeType,
} from '@server/services/synapse/types.ts'
import type {
  SynapseNode,
  SynapseEdge,
  GraphData,
  IndexingStatus,
} from '@server/services/synapse/types.ts'

describe('SynapseNodeKind', () => {
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

    expect(Object.values(SynapseNodeKind)).toHaveLength(expected.length)

    for (const value of expected) {
      expect(SynapseNodeKind[value as keyof typeof SynapseNodeKind]).toBe(value)
    }
  })
})

describe('SynapseEdgeType', () => {
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

    expect(Object.values(SynapseEdgeType)).toHaveLength(expected.length)

    for (const value of expected) {
      expect(SynapseEdgeType[value as keyof typeof SynapseEdgeType]).toBe(value)
    }
  })
})

describe('SynapseNode', () => {
  it('is constructable with correct types', () => {
    const node: SynapseNode = {
      id: 'src/hooks/useChat:useChat',
      kind: SynapseNodeKind.Function,
      name: 'useChat',
      filePath: 'src/hooks/useChat.ts',
      range: { startLine: 1, endLine: 50 },
      exported: true,
    }

    expect(node.id).toBe('src/hooks/useChat:useChat')
    expect(node.kind).toBe(SynapseNodeKind.Function)
    expect(node.name).toBe('useChat')
    expect(node.filePath).toBe('src/hooks/useChat.ts')
    expect(node.range?.startLine).toBe(1)
    expect(node.range?.endLine).toBe(50)
    expect(node.exported).toBe(true)
    expect(node.metadata).toBeUndefined()
  })

  it('allows optional range and metadata', () => {
    const node: SynapseNode = {
      id: 'src/index.ts',
      kind: SynapseNodeKind.File,
      name: 'index.ts',
      filePath: 'src/index.ts',
      exported: false,
      metadata: { size: 1024 },
    }

    expect(node.range).toBeUndefined()
    expect(node.metadata).toEqual({ size: 1024 })
  })
})

describe('SynapseEdge', () => {
  it('is constructable with correct types', () => {
    const edge: SynapseEdge = {
      source: 'src/hooks/useChat:useChat',
      target: 'src/services/api:fetchData',
      type: SynapseEdgeType.CALLS,
      confidence: 0.95,
    }

    expect(edge.source).toBe('src/hooks/useChat:useChat')
    expect(edge.target).toBe('src/services/api:fetchData')
    expect(edge.type).toBe(SynapseEdgeType.CALLS)
    expect(edge.confidence).toBe(0.95)
    expect(edge.metadata).toBeUndefined()
  })

  it('allows optional metadata', () => {
    const edge: SynapseEdge = {
      source: 'src/App.tsx',
      target: 'src/components/Chat.tsx',
      type: SynapseEdgeType.IMPORTS,
      confidence: 1.0,
      metadata: { importName: 'ChatLayout' },
    }

    expect(edge.metadata).toEqual({ importName: 'ChatLayout' })
  })
})

describe('GraphData', () => {
  it('composes nodes and edges', () => {
    const nodes: SynapseNode[] = [
      {
        id: 'src/App.tsx',
        kind: SynapseNodeKind.File,
        name: 'App.tsx',
        filePath: 'src/App.tsx',
        exported: true,
      },
      {
        id: 'src/hooks/useChat:useChat',
        kind: SynapseNodeKind.Function,
        name: 'useChat',
        filePath: 'src/hooks/useChat.ts',
        exported: true,
      },
    ]

    const edges: SynapseEdge[] = [
      {
        source: 'src/App.tsx',
        target: 'src/hooks/useChat:useChat',
        type: SynapseEdgeType.IMPORTS,
        confidence: 1.0,
      },
    ]

    const graph: GraphData = { nodes, edges }

    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(graph.nodes[0].kind).toBe(SynapseNodeKind.File)
    expect(graph.edges[0].type).toBe(SynapseEdgeType.IMPORTS)
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