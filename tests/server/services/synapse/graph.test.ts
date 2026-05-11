import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { SynapseIndexer } from '@server/services/synapse/indexer.ts'
import { SynapseQueryService } from '@server/services/synapse/graph.ts'
import { SynapseNodeKind, SynapseEdgeType } from '@server/services/synapse/types.ts'
import type { SynapseNode } from '@server/services/synapse/types.ts'

const TMP_PREFIX = 'data-test-synapse-graph'

let projectDir: string

beforeEach(() => {
  projectDir = fsSync.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + '-'))

  // Create a simple project structure
  fsSync.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
  fsSync.mkdirSync(path.join(projectDir, 'src', 'utils'), { recursive: true })

  // src/index.ts - imports from utils and declares main function
  fsSync.writeFileSync(
    path.join(projectDir, 'src', 'index.ts'),
    `import { helper } from './utils/helper';
import { greet } from './utils/greet';

function main() {
  helper();
  greet("world");
}
`,
  )

  // src/utils/helper.ts - exports a helper function
  fsSync.writeFileSync(
    path.join(projectDir, 'src', 'utils', 'helper.ts'),
    `export function helper() {
  return 42;
}
`,
  )

  // src/utils/greet.ts - exports a greet function
  fsSync.writeFileSync(
    path.join(projectDir, 'src', 'utils', 'greet.ts'),
    `export function greet(name) {
  return "hello " + name;
}
`,
  )
})

afterEach(() => {
  fsSync.rmSync(projectDir, { recursive: true, force: true })
})

describe('SynapseQueryService', () => {
  async function buildAndLoad(): Promise<SynapseQueryService> {
    const indexer = new SynapseIndexer(projectDir)
    await indexer.indexProject()

    const service = new SynapseQueryService(projectDir)
    await service.load()
    return service
  }

  it('loads graph from .synapse/graph.json', async () => {
    const service = await buildAndLoad()

    expect(service.isLoaded()).toBe(true)
    const graph = service.getGraph()
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  it('gets node by id', async () => {
    const service = await buildAndLoad()
    const graph = service.getGraph()

    // Pick any node and verify we can retrieve it
    const firstNode = graph.nodes[0]
    const node = service.getNode(firstNode.id)
    expect(node).toBeDefined()
    expect(node!.id).toBe(firstNode.id)
  })

  it('returns null for unknown node', async () => {
    const service = await buildAndLoad()
    const node = service.getNode('nonexistent:node')
    expect(node).toBeNull()
  })

  it('performs downstream impact analysis', async () => {
    const service = await buildAndLoad()

    // Find the helper.ts file node
    const helperFile = service.getGraph().nodes.find(
      n => n.filePath === 'src/utils/helper.ts' && n.kind === SynapseNodeKind.File,
    )
    expect(helperFile).toBeDefined()

    const result = service.impact(helperFile!.id, 'downstream')

    expect(result.target).toBe(helperFile!.id)
    expect(result.direction).toBe('downstream')
    // Downstream from helper.ts should include index.ts (which depends on helper.ts)
    expect(result.levels.length).toBeGreaterThan(0)

    // Check that index.ts appears in some impact level
    const allImpactNodes = result.levels.flatMap(l => l.nodes)
    const indexRef = allImpactNodes.find(n => n.filePath === 'src/index.ts')
    expect(indexRef).toBeDefined()
  })

  it('performs upstream impact analysis', async () => {
    const service = await buildAndLoad()

    // Find index.ts file node
    const indexFile = service.getGraph().nodes.find(
      n => n.filePath === 'src/index.ts' && n.kind === SynapseNodeKind.File,
    )
    expect(indexFile).toBeDefined()

    const result = service.impact(indexFile!.id, 'upstream')

    expect(result.target).toBe(indexFile!.id)
    expect(result.direction).toBe('upstream')
    // Upstream from index.ts should include helper.ts and/or greet.ts
    expect(result.levels.length).toBeGreaterThan(0)

    const allImpactNodes = result.levels.flatMap(l => l.nodes)
    const helperRef = allImpactNodes.find(n => n.filePath === 'src/utils/helper.ts')
    expect(helperRef).toBeDefined()
  })

  it('returns 360-degree context for a symbol', async () => {
    const service = await buildAndLoad()

    // Find the helper function symbol node
    const helperFunc = service.getGraph().nodes.find(
      n => n.name === 'helper' && n.kind === SynapseNodeKind.Function,
    )
    expect(helperFunc).toBeDefined()

    const ctx = service.context(helperFunc!.id)
    expect(ctx).not.toBeNull()
    expect(ctx!.node.id).toBe(helperFunc!.id)

    // The function should have some context entries
    // It may have incoming references and outgoing edges
    expect(ctx!.incoming !== undefined).toBe(true)
    expect(ctx!.outgoing !== undefined).toBe(true)
  })

  it('returns 360-degree context for a file', async () => {
    const service = await buildAndLoad()

    const helperFile = service.getGraph().nodes.find(
      n => n.filePath === 'src/utils/helper.ts' && n.kind === SynapseNodeKind.File,
    )
    expect(helperFile).toBeDefined()

    const ctx = service.context(helperFile!.id)
    expect(ctx).not.toBeNull()
    expect(ctx!.node.id).toBe(helperFile!.id)

    // File should have members (symbols it CONTAINS)
    expect(ctx!.members.length).toBeGreaterThan(0)

    // Members should include the helper function
    const helperMember = ctx!.members.find(m => m.name === 'helper')
    expect(helperMember).toBeDefined()
  })

  it('searches nodes by name', async () => {
    const service = await buildAndLoad()

    const results = service.search('helper')
    expect(results.length).toBeGreaterThan(0)

    // The top result should match "helper" exactly or contain it
    const topResult = results[0]
    expect(topResult.node.name.toLowerCase()).toContain('helper')
    expect(topResult.score).toBeGreaterThan(0)
  })

  it('searches nodes by file path', async () => {
    const service = await buildAndLoad()

    const results = service.search('helper.ts')
    expect(results.length).toBeGreaterThan(0)

    // Should find nodes from helper.ts
    const hasHelperTsNode = results.some(r => r.node.filePath.includes('helper'))
    expect(hasHelperTsNode).toBe(true)
  })

  it('gets dependents of a node', async () => {
    const service = await buildAndLoad()

    // Find the helper.ts file node
    const helperFile = service.getGraph().nodes.find(
      n => n.filePath === 'src/utils/helper.ts' && n.kind === SynapseNodeKind.File,
    )
    expect(helperFile).toBeDefined()

    const deps = service.dependents(helperFile!.id)

    // index.ts depends on helper.ts, so it should appear as a dependent
    const indexDep = deps.find(n => n.filePath === 'src/index.ts')
    expect(indexDep).toBeDefined()
  })

  it('gets dependencies of a node', async () => {
    const service = await buildAndLoad()

    // Find index.ts file node
    const indexFile = service.getGraph().nodes.find(
      n => n.filePath === 'src/index.ts' && n.kind === SynapseNodeKind.File,
    )
    expect(indexFile).toBeDefined()

    const deps = service.dependencies(indexFile!.id)

    // index.ts depends on helper.ts and/or greet.ts
    const helperDep = deps.find(n => n.filePath === 'src/utils/helper.ts')
    expect(helperDep).toBeDefined()
  })
})