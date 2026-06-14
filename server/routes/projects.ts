import { Router } from 'express'
import { mkdir, access, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import path from 'path'
import type { ProjectService } from '../services/project.ts'
import type { OllamaService } from '../services/ollama.ts'
import type { FileStore } from '../storage/fileStore.ts'

/** Extract repo name from a GitHub URL (e.g. "https://github.com/user/repo" → "repo") */
function extractRepoName(url: string): string {
  const cleaned = url.replace(/\.git$/, '')
  const segments = cleaned.split('/').filter(Boolean)
  return segments[segments.length - 1] || 'github-project'
}

/** Check if a string looks like a GitHub URL */
export function isGithubUrl(input: string): boolean {
  return /^https?:\/\/github\.com\/.+\/.+/.test(input) || /^github\.com\/.+\/.+/.test(input)
}

/** Normalize a GitHub URL to a full HTTPS URL */
function normalizeGithubUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return 'https://' + url
}

export function createProjectsRouter(projectService: ProjectService, ollama: OllamaService, store: FileStore) {
  const router = Router()

  // GET / - List all projects (sync filesystem first)
  router.get('/', async (_req, res) => {
    try {
      await projectService.syncWithFilesystem()
      const projects = await projectService.list()
      res.json({ projects })
    } catch (error) {
      res.status(500).json({ error: 'Failed to list projects' })
    }
  })

  // POST /generate-name - Generate a project name from a user prompt using AI
  router.post('/generate-name', async (req, res) => {
    try {
      const { prompt } = req.body
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required' })
        return
      }

      const settings = await store.read<Record<string, unknown>>('settings.json')
      const model = (settings?.defaultProjectModel as string) || (settings?.defaultModel as string) || 'llama3.2'

      // Get existing project names so the AI avoids duplicates
      const existingProjects = await projectService.list()
      const existingNames = existingProjects.map(p => p.name)

      const avoidSection = existingNames.length > 0
        ? `\n\nThe following project names already exist — do NOT use any of them: ${existingNames.join(', ')}. Generate a different, unique name.`
        : ''

      const nameResponse = await ollama.chat({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Generate a short, filesystem-safe project name from the user prompt. Use only lowercase letters, numbers, and hyphens. No spaces, no special characters. Output ONLY the name, nothing else. Examples: "build me a todo app" -> "todo-app", "create a weather dashboard" -> "weather-dashboard", "I want to make a chat application with react" -> "react-chat-app". Keep it under 40 characters.' + avoidSection,
          },
          { role: 'user', content: prompt },
        ],
        stream: false,
      })

      let name = nameResponse.message.content.trim().toLowerCase()
      name = name.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      name = name.substring(0, 40).replace(/-+$/, '')

      // Fallback dedup: if the AI still produced a duplicate, append a number
      const nameExists = (n: string) => existingNames.some(en => en.toLowerCase() === n.toLowerCase())
      if (name && nameExists(name)) {
        let suffix = 2
        while (nameExists(`${name}-${suffix}`)) suffix++
        name = `${name}-${suffix}`
      }

      if (!name) {
        name = `project-${Date.now()}`
      }

      res.json({ name })
    } catch {
      res.json({ name: `project-${Date.now()}` })
    }
  })

  // POST /create-with-path - Create project directory and project record
  router.post('/create-with-path', async (req, res) => {
    try {
      const { name, description, workspacePath } = req.body
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' })
        return
      }
      if (!workspacePath || typeof workspacePath !== 'string') {
        res.status(400).json({ error: 'workspacePath is required' })
        return
      }

      await mkdir(workspacePath, { recursive: true })

      // Initialize git repo with .gitignore and initial commit
      try {
        const gitignoreContent = `.aura/*
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
Thumbs.db
`
        await writeFile(path.join(workspacePath, '.gitignore'), gitignoreContent, 'utf-8')

        await new Promise<void>((resolve, reject) => {
          execFile('git', ['init'], { cwd: workspacePath, timeout: 15000 }, (err) => {
            if (err) reject(err); else resolve()
          })
        })

        await new Promise<void>((resolve, reject) => {
          execFile('git', ['add', '-A'], { cwd: workspacePath, timeout: 15000 }, (err) => {
            if (err) reject(err); else resolve()
          })
        })

        await new Promise<void>((resolve, reject) => {
          execFile('git', ['commit', '-m', 'chore: initial commit', '--no-gpg-sign'], { cwd: workspacePath, timeout: 15000 }, (err) => {
            if (err) reject(err); else resolve()
          })
        })
      } catch (gitError) {
        // Git init is best-effort — project creation should succeed even if git is unavailable
        console.warn(`[Projects] Git init failed for ${workspacePath}:`, gitError instanceof Error ? gitError.message : gitError)
      }

      const project = await projectService.create(name, description ?? '', workspacePath)
      res.status(201).json(project)
    } catch (error: any) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        res.status(403).json({ error: 'Permission denied creating project directory' })
        return
      }
      res.status(500).json({ error: 'Failed to create project' })
    }
  })

  // POST /add-existing - Find or create a project by workspace path
  // If a project with this workspacePath exists, return it. Otherwise create one (no directory creation).
  router.post('/add-existing', async (req, res) => {
    try {
      const { workspacePath, name } = req.body
      if (!workspacePath || typeof workspacePath !== 'string') {
        res.status(400).json({ error: 'workspacePath is required' })
        return
      }

      // Check if a project with this path already exists
      const projects = await projectService.list()
      const existing = projects.find((p) => p.workspacePath === workspacePath)
      if (existing) {
        res.json(existing)
        return
      }

      // Verify the path exists on disk
      try {
        await access(workspacePath)
      } catch {
        res.status(400).json({ error: 'Path does not exist on disk' })
        return
      }

      const projectName = (name && typeof name === 'string' ? name : workspacePath.split(/[\\/]/).pop() || workspacePath)
      const project = await projectService.create(projectName, '', workspacePath)
      res.status(201).json(project)
    } catch (error) {
      res.status(500).json({ error: 'Failed to add existing project' })
    }
  })

  // POST /clone-github - Clone a GitHub repo and create a project record
  router.post('/clone-github', async (req, res) => {
    try {
      const { url, name } = req.body
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'url is required' })
        return
      }

      const normalizedUrl = normalizeGithubUrl(url)
      if (!isGithubUrl(normalizedUrl)) {
        res.status(400).json({ error: 'Invalid GitHub URL' })
        return
      }

      const settings = await store.read<Record<string, unknown>>('settings.json')
      const defaultPath = (settings?.defaultProjectPath as string) || ''
      if (!defaultPath) {
        res.status(400).json({ error: 'Default project path not set. Set it in Settings first.' })
        return
      }

      const repoName = (name && typeof name === 'string' ? name : extractRepoName(normalizedUrl))
      const baseName = repoName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
      const projects = await projectService.list()

      // Deduplicate name
      const nameExists = (n: string) => projects.some(p => p.name.toLowerCase() === n.toLowerCase())
      let uniqueName = baseName
      if (nameExists(uniqueName)) {
        let suffix = 2
        while (nameExists(`${baseName}-${suffix}`)) suffix++
        uniqueName = `${baseName}-${suffix}`
      }

      const workspacePath = defaultPath.replace(/[/\\]+$/, '') + (defaultPath.includes('\\') ? '\\' : '/') + uniqueName

      // Check if a project with this gitUrl already exists
      const existingByGitUrl = projects.find(p => p.gitUrl === normalizedUrl)
      if (existingByGitUrl) {
        res.json(existingByGitUrl)
        return
      }

      // Clone the repo
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['clone', normalizedUrl, workspacePath], { timeout: 120000 }, (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message))
          } else {
            resolve()
          }
        })
      })

      const project = await projectService.create(uniqueName, `Cloned from ${normalizedUrl}`, workspacePath)
      // Add gitUrl to the project record
      const updated = await projectService.update(project.id, { gitUrl: normalizedUrl })
      res.status(201).json(updated || project)
    } catch (error: any) {
      if (error.message?.includes('already exists and is not an empty directory')) {
        res.status(409).json({ error: 'Directory already exists' })
      } else if (error.message?.includes('repository not found') || error.message?.includes('Authentication failed')) {
        res.status(404).json({ error: 'Repository not found or inaccessible' })
      } else {
        res.status(500).json({ error: error.message || 'Failed to clone repository' })
      }
    }
  })

  // POST / - Create a project (no directory creation)
  router.post('/', async (req, res) => {
    try {
      const { name, description, workspacePath } = req.body
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' })
        return
      }
      if (!workspacePath || typeof workspacePath !== 'string') {
        res.status(400).json({ error: 'workspacePath is required' })
        return
      }
      const project = await projectService.create(name, description ?? '', workspacePath)
      res.status(201).json(project)
    } catch (error) {
      res.status(500).json({ error: 'Failed to create project' })
    }
  })

  // GET /:id - Get a single project
  router.get('/:id', async (req, res) => {
    try {
      const project = await projectService.get(req.params.id)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      res.json(project)
    } catch (error) {
      res.status(500).json({ error: 'Failed to get project' })
    }
  })

  // PUT /:id - Update a project
  router.put('/:id', async (req, res) => {
    try {
      const { name, description, status, workspacePath } = req.body
      const updates: Record<string, unknown> = {}
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (status !== undefined) updates.status = status
      if (workspacePath !== undefined) updates.workspacePath = workspacePath

      const project = await projectService.update(req.params.id, updates)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      res.json(project)
    } catch (error) {
      res.status(500).json({ error: 'Failed to update project' })
    }
  })

  // DELETE /:id - Delete from builder only (keep local files)
  router.delete('/:id', async (req, res) => {
    try {
      const deleted = await projectService.delete(req.params.id)
      if (!deleted) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      res.status(204).end()
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete project' })
    }
  })

  // DELETE /:id/files - Delete from everywhere (remove local files + builder record)
  router.delete('/:id/files', async (req, res) => {
    try {
      const result = await projectService.deleteWithFiles(req.params.id)
      if (!result.deleted) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete project with files' })
    }
  })

  // POST /sync - Sync filesystem (remove ghost projects whose paths no longer exist)
  router.post('/sync', async (_req, res) => {
    try {
      const removedIds = await projectService.syncWithFilesystem()
      res.json({ removed: removedIds })
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync projects with filesystem' })
    }
  })

  // GET /:id/verify - Verify a project's workspace path exists
  router.get('/:id/verify', async (req, res) => {
    try {
      const project = await projectService.get(req.params.id)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const { access } = await import('fs/promises')
      let exists = false
      try {
        await access(project.workspacePath)
        exists = true
      } catch {
        exists = false
      }
      res.json({ exists, project })
    } catch (error) {
      res.status(500).json({ error: 'Failed to verify project path' })
    }
  })

  return router
}