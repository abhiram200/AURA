import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { AuraIndexer } from '@server/services/aura/indexer.ts'
import { AuraNodeKind, AuraEdgeType } from '@server/services/aura/types.ts'
import type { IndexingStatus } from '@server/services/aura/types.ts'

const TMP_PREFIX = 'data-test-aura-indexer'

let projectDir: string

beforeEach(() => {
  projectDir = fsSync.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + '-'))

  // Create a simple project structure
  fsSync.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
  fsSync.mkdirSync(path.join(projectDir, 'src', 'utils'), { recursive: true })

  // src/index.ts - imports from ./utils and declares main function
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

  // src/utils/helper.ts - exports a function
  fsSync.writeFileSync(
    path.join(projectDir, 'src', 'utils', 'helper.ts'),
    `export function helper() {
  return 42;
}
`,
  )

  // src/utils/greet.ts - exports a function
  fsSync.writeFileSync(
    path.join(projectDir, 'src', 'utils', 'greet.ts'),
    `export function greet(name) {
  return "hello " + name;
}
`,
  )

  // Create a node_modules directory that should be ignored
  fsSync.mkdirSync(path.join(projectDir, 'node_modules', 'some-pkg'), { recursive: true })
  fsSync.writeFileSync(
    path.join(projectDir, 'node_modules', 'some-pkg', 'index.js'),
    `module.exports = {};`,
  )

  // Create a .aura directory that should be ignored
  fsSync.mkdirSync(path.join(projectDir, '.aura'), { recursive: true })
  fsSync.writeFileSync(
    path.join(projectDir, '.aura', 'old-graph.json'),
    `{"nodes":[],"edges":[]}`,
  )
})

afterEach(() => {
  fsSync.rmSync(projectDir, { recursive: true, force: true })
})

describe('AuraIndexer', () => {
  describe('scan()', () => {
    it('finds source files in the project', async () => {
      const indexer = new AuraIndexer(projectDir)
      const files = await indexer.scan()

      // Should find the 3 .ts files
      expect(files.length).toBe(3)

      // All files should be parsable
      const basenames = files.map(f => path.basename(f))
      expect(basenames).toContain('index.ts')
      expect(basenames).toContain('helper.ts')
      expect(basenames).toContain('greet.ts')
    })

    it('ignores node_modules', async () => {
      const indexer = new AuraIndexer(projectDir)
      const files = await indexer.scan()

      for (const f of files) {
        expect(f).not.toContain('node_modules')
      }
    })

    it('ignores .aura directory', async () => {
      const indexer = new AuraIndexer(projectDir)
      const files = await indexer.scan()

      for (const f of files) {
        expect(f).not.toContain('.aura')
      }
    })

    it('respects .gitignore patterns', async () => {
      // Create a .gitignore that ignores the utils directory
      fsSync.writeFileSync(
        path.join(projectDir, '.gitignore'),
        `node_modules
dist
*.generated.ts
`,
      )

      // Create a file that matches .gitignore pattern
      fsSync.writeFileSync(
        path.join(projectDir, 'src', 'stuff.generated.ts'),
        `export const stuff = "generated";`,
      )

      const indexer = new AuraIndexer(projectDir)
      const files = await indexer.scan()

      const basenames = files.map(f => path.basename(f))
      expect(basenames).not.toContain('stuff.generated.ts')
    })
  })

  describe('indexProject()', () => {
    it('runs the full pipeline on a sample project', async () => {
      const indexer = new AuraIndexer(projectDir)
      const graph = await indexer.indexProject()

      // Should have file nodes
      const fileNodes = graph.nodes.filter(n => n.kind === AuraNodeKind.File)
      expect(fileNodes.length).toBe(3)

      // Should have symbol nodes (functions from the source files)
      const symbolNodes = graph.nodes.filter(n => n.kind !== AuraNodeKind.File)
      expect(symbolNodes.length).toBeGreaterThan(0)

      // Should have function symbols
      const functionNodes = graph.nodes.filter(n => n.kind === AuraNodeKind.Function)
      expect(functionNodes.length).toBeGreaterThan(0)
    })

    it('creates CONTAINS edges from file to symbols', async () => {
      const indexer = new AuraIndexer(projectDir)
      const graph = await indexer.indexProject()

      const containsEdges = graph.edges.filter(e => e.type === AuraEdgeType.CONTAINS)
      expect(containsEdges.length).toBeGreaterThan(0)

      // Each CONTAINS edge should have a file as source and a symbol id as target
      for (const edge of containsEdges) {
        expect(edge.source).toContain('.ts')
        expect(edge.target).toContain(':')
      }
    })

    it('creates IMPORTS edges and resolves relative imports', async () => {
      const indexer = new AuraIndexer(projectDir)
      const graph = await indexer.indexProject()

      const importsEdges = graph.edges.filter(e => e.type === AuraEdgeType.IMPORTS)
      expect(importsEdges.length).toBeGreaterThan(0)

      // Find the import from index.ts to helper.ts
      const helperImport = importsEdges.find(e =>
        e.source === 'src/index.ts' &&
        (e.target === 'src/utils/helper.ts' || e.metadata?.rawImportPath === './utils/helper'),
      )
      expect(helperImport).toBeDefined()

      // Resolved imports should have high confidence
      if (helperImport && !helperImport.target.startsWith('.')) {
        expect(helperImport.confidence).toBeGreaterThanOrEqual(0.9)
      }
    })

    it('creates DEPENDS_ON edges between files', async () => {
      const indexer = new AuraIndexer(projectDir)
      const graph = await indexer.indexProject()

      const dependsOnEdges = graph.edges.filter(e => e.type === AuraEdgeType.DEPENDS_ON)
      expect(dependsOnEdges.length).toBeGreaterThan(0)

      // index.ts should depend on helper.ts and/or greet.ts
      const indexDeps = dependsOnEdges.filter(e => e.source === 'src/index.ts')
      expect(indexDeps.length).toBeGreaterThan(0)
    })

    it('saves graph.json and meta.json to .aura directory', async () => {
      const indexer = new AuraIndexer(projectDir)
      await indexer.indexProject()

      const graphPath = path.join(projectDir, '.aura', 'graph.json')
      const metaPath = path.join(projectDir, '.aura', 'meta.json')

      expect(fsSync.existsSync(graphPath)).toBe(true)
      expect(fsSync.existsSync(metaPath)).toBe(true)

      // Verify graph.json is valid JSON with nodes and edges
      const graphData = JSON.parse(fsSync.readFileSync(graphPath, 'utf-8'))
      expect(graphData.nodes).toBeDefined()
      expect(graphData.edges).toBeDefined()
      expect(graphData.nodes.length).toBeGreaterThan(0)

      // Verify meta.json has required fields
      const metaData = JSON.parse(fsSync.readFileSync(metaPath, 'utf-8'))
      expect(metaData.indexedAt).toBeDefined()
      expect(metaData.stats).toBeDefined()
      expect(metaData.stats.totalFiles).toBeGreaterThan(0)
      expect(metaData.stats.totalNodes).toBeGreaterThan(0)
      expect(metaData.stats.totalEdges).toBeGreaterThan(0)
      expect(metaData.stats.nodesByKind).toBeDefined()
      expect(metaData.stats.edgesByType).toBeDefined()
    })
  })

  describe('getStatus()', () => {
    it('returns initial idle status', () => {
      const indexer = new AuraIndexer(projectDir)
      const status = indexer.getStatus()

      expect(status.phase).toBe('idle')
      expect(status.progress).toBe(0)
    })

    it('returns complete status after indexing', async () => {
      const indexer = new AuraIndexer(projectDir)
      await indexer.indexProject()
      const status = indexer.getStatus()

      expect(status.phase).toBe('complete')
      expect(status.progress).toBe(1.0)
      expect(status.totalFiles).toBeGreaterThan(0)
      expect(status.nodesFound).toBeGreaterThan(0)
      expect(status.edgesFound).toBeGreaterThan(0)
    })
  })

  describe('onStatus()', () => {
    it('notifies listeners of status changes during indexing', async () => {
      const indexer = new AuraIndexer(projectDir)
      const statuses: IndexingStatus[] = []

      const unsubscribe = indexer.onStatus((status) => {
        statuses.push({ ...status })
      })

      await indexer.indexProject()

      // Should have received multiple status updates
      expect(statuses.length).toBeGreaterThan(0)

      // First update should be scanning
      expect(statuses[0].phase).toBe('scanning')

      // Last update should be complete
      const lastStatus = statuses[statuses.length - 1]
      expect(lastStatus.phase).toBe('complete')
      expect(lastStatus.progress).toBe(1.0)

      // Unsubscribe should work
      unsubscribe()
    })

    it('stops sending updates after unsubscribe', async () => {
      const indexer = new AuraIndexer(projectDir)
      let count = 0

      const unsubscribe = indexer.onStatus(() => {
        count++
      })

      unsubscribe()

      // After unsubscribe, indexProject should not trigger the listener
      // (but it will still work - just no callbacks to this listener)
      await indexer.indexProject()
      expect(count).toBe(0)
    })
  })
})