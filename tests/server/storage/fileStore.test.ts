import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileStore } from '../../../server/storage/fileStore.ts'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_DIR = join(process.cwd(), 'data-test-filestore')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('FileStore', () => {
  it('reads a JSON file and returns parsed data', async () => {
    const store = new FileStore(TEST_DIR)
    const data = [{ id: '1', name: 'test' }]
    await store.write('test.json', data)
    const result = await store.read('test.json')
    expect(result).toEqual(data)
  })

  it('returns null when file does not exist', async () => {
    const store = new FileStore(TEST_DIR)
    const result = await store.read('missing.json')
    expect(result).toBeNull()
  })

  it('returns default value when file does not exist', async () => {
    const store = new FileStore(TEST_DIR)
    const result = await store.read('missing.json', [])
    expect(result).toEqual([])
  })

  it('writes and reads back data correctly', async () => {
    const store = new FileStore(TEST_DIR)
    const settings = { theme: 'dark', fontSize: 16 }
    await store.write('settings.json', settings)
    const result = await store.read('settings.json')
    expect(result).toEqual(settings)
  })

  it('deletes a file', async () => {
    const store = new FileStore(TEST_DIR)
    await store.write('temp.json', { x: 1 })
    await store.delete('temp.json')
    const result = await store.read('temp.json')
    expect(result).toBeNull()
  })

  it('lists files in a directory', async () => {
    const store = new FileStore(TEST_DIR)
    await store.write('conv1.json', { id: '1' })
    await store.write('conv2.json', { id: '2' })
    const files = await store.listFiles('')
    expect(files.sort()).toEqual(['conv1.json', 'conv2.json'].sort())
  })

  it('lists files in a subdirectory', async () => {
    const store = new FileStore(TEST_DIR)
    await store.write('conversations/conv1.json', { id: '1' })
    await store.write('conversations/conv2.json', { id: '2' })
    const files = await store.listFiles('conversations')
    expect(files.sort()).toEqual(['conv1.json', 'conv2.json'].sort())
  })
})