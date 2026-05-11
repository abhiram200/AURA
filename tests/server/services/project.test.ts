import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProjectService } from '../../../server/services/project.ts'
import { FileStore } from '../../../server/storage/fileStore.ts'
import { mkdirSync, rmSync, mkdirSync as mkdir, existsSync, writeFileSync } from 'fs'
import { join } from 'path'

const TEST_DIR = join(process.cwd(), 'data-test-project')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('ProjectService', () => {
  const store = new FileStore(TEST_DIR)
  const service = new ProjectService(store)

  it('inits with empty array if no file exists', async () => {
    await service.init()
    const projects = await service.list()
    expect(projects).toEqual([])
  })

  it('does not overwrite existing projects on init', async () => {
    await service.init()
    await service.create('Existing', '', '/tmp/existing')
    await service.init()
    const projects = await service.list()
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('Existing')
  })

  it('creates a project', async () => {
    await service.init()
    const project = await service.create('My App', 'A cool app', '/tmp/my-app')
    expect(project.id).toMatch(/^proj_/)
    expect(project.name).toBe('My App')
    expect(project.description).toBe('A cool app')
    expect(project.workspacePath).toBe('/tmp/my-app')
    expect(project.status).toBe('active')
    expect(project.createdAt).toBeDefined()
    expect(project.updatedAt).toBeDefined()
  })

  it('uses workspacePath basename as default description', async () => {
    await service.init()
    const project = await service.create('My App', '', '/tmp/my-app')
    expect(project.description).toBe('my-app')
  })

  it('lists projects sorted by updatedAt descending', async () => {
    await service.init()
    const p1 = await service.create('First', '', '/tmp/first')
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10))
    const p2 = await service.create('Second', '', '/tmp/second')
    const list = await service.list()
    expect(list[0].id).toBe(p2.id)
    expect(list[1].id).toBe(p1.id)
  })

  it('gets a project by id', async () => {
    await service.init()
    const created = await service.create('Test', '', '/tmp/test')
    const fetched = await service.get(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.name).toBe('Test')
  })

  it('returns null for non-existent project', async () => {
    await service.init()
    const result = await service.get('proj_nonexistent')
    expect(result).toBeNull()
  })

  it('updates a project', async () => {
    await service.init()
    const created = await service.create('Original', '', '/tmp/original')
    const updated = await service.update(created.id, { name: 'Updated', status: 'completed' })
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('Updated')
    expect(updated!.status).toBe('completed')
    expect(updated!.updatedAt).not.toBe(created.updatedAt)
  })

  it('returns null when updating non-existent project', async () => {
    await service.init()
    const result = await service.update('proj_nonexistent', { name: 'X' })
    expect(result).toBeNull()
  })

  it('deletes a project from builder', async () => {
    await service.init()
    const created = await service.create('To Delete', '', '/tmp/to-delete')
    const result = await service.delete(created.id)
    expect(result).toBe(true)
    const fetched = await service.get(created.id)
    expect(fetched).toBeNull()
  })

  it('returns false when deleting non-existent project', async () => {
    await service.init()
    const result = await service.delete('proj_nonexistent')
    expect(result).toBe(false)
  })

  describe('deleteWithFiles', () => {
    it('deletes project and removes local directory', async () => {
      const localDir = join(TEST_DIR, 'project-to-remove')
      mkdir(localDir, { recursive: true })
      writeFileSync(join(localDir, 'file.txt'), 'test')

      await service.init()
      const created = await service.create('Remove Me', '', localDir)

      const result = await service.deleteWithFiles(created.id)
      expect(result.deleted).toBe(true)
      expect(result.pathRemoved).toBe(true)
      expect(existsSync(localDir)).toBe(false)

      const fetched = await service.get(created.id)
      expect(fetched).toBeNull()
    })

    it('deletes project even if directory is already gone', async () => {
      const localDir = join(TEST_DIR, 'already-gone')
      // Don't create the directory

      await service.init()
      const created = await service.create('Already Gone', '', localDir)

      const result = await service.deleteWithFiles(created.id)
      expect(result.deleted).toBe(true)
      expect(result.pathRemoved).toBe(false)

      const fetched = await service.get(created.id)
      expect(fetched).toBeNull()
    })

    it('refuses to delete dangerous paths but still removes builder record', async () => {
      await service.init()
      const created = await service.create('Dangerous', '', '/')

      const result = await service.deleteWithFiles(created.id)
      expect(result.deleted).toBe(true)
      expect(result.pathRemoved).toBe(false)

      const fetched = await service.get(created.id)
      expect(fetched).toBeNull()
    })

    it('returns false for non-existent project', async () => {
      await service.init()
      const result = await service.deleteWithFiles('proj_nonexistent')
      expect(result.deleted).toBe(false)
      expect(result.pathRemoved).toBe(false)
    })
  })

  describe('syncWithFilesystem', () => {
    it('removes projects whose workspace path no longer exists', async () => {
      const existingDir = join(TEST_DIR, 'existing-project')
      mkdir(existingDir, { recursive: true })
      const ghostDir = join(TEST_DIR, 'ghost-project')
      // Don't create ghostDir

      await service.init()
      await service.create('Existing', '', existingDir)
      await service.create('Ghost', '', ghostDir)

      const removedIds = await service.syncWithFilesystem()
      expect(removedIds).toHaveLength(1)

      const remaining = await service.list()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].name).toBe('Existing')
    })

    it('keeps projects with empty workspace path', async () => {
      await service.init()
      await service.create('No Path', '', '')

      const removedIds = await service.syncWithFilesystem()
      expect(removedIds).toHaveLength(0)

      const remaining = await service.list()
      expect(remaining).toHaveLength(1)
    })

    it('keeps projects whose paths still exist', async () => {
      const existingDir = join(TEST_DIR, 'still-here')
      mkdir(existingDir, { recursive: true })

      await service.init()
      await service.create('Still Here', '', existingDir)

      const removedIds = await service.syncWithFilesystem()
      expect(removedIds).toHaveLength(0)

      const remaining = await service.list()
      expect(remaining).toHaveLength(1)
    })

    it('returns empty array when all projects are valid', async () => {
      const dir = join(TEST_DIR, 'valid-project')
      mkdir(dir, { recursive: true })

      await service.init()
      await service.create('Valid', '', dir)

      const removedIds = await service.syncWithFilesystem()
      expect(removedIds).toHaveLength(0)
    })

    it('handles multiple ghost projects', async () => {
      const existingDir = join(TEST_DIR, 'alive')
      mkdir(existingDir, { recursive: true })

      await service.init()
      await service.create('Alive', '', existingDir)
      await service.create('Ghost1', '', join(TEST_DIR, 'ghost1'))
      await service.create('Ghost2', '', join(TEST_DIR, 'ghost2'))

      const removedIds = await service.syncWithFilesystem()
      expect(removedIds).toHaveLength(2)

      const remaining = await service.list()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].name).toBe('Alive')
    })
  })
})