import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { join, basename } from 'path'
import { FileStore } from './storage/fileStore.ts'
import { OllamaService } from './services/ollama.ts'
import { ContextService } from './services/context.ts'
import { ConversationService } from './services/conversation.ts'
import { MemoryService } from './services/memory.ts'
import { SkillsService } from './services/skills.ts'
import { WebSearchService } from './services/aura/web-search.ts'
import { ProjectService } from './services/project.ts'
import { GroupService } from './services/group.ts'
import { createChatRouter } from './routes/chat.ts'
import { createModelsRouter } from './routes/models.ts'
import { createConversationsRouter } from './routes/conversations.ts'
import { createMemoryRouter } from './routes/memory.ts'
import { createSkillsRouter } from './routes/skills.ts'
import { createProjectsRouter } from './routes/projects.ts'
import { createWorkspaceRouter } from './routes/workspace.ts'
import { createSettingsRouter } from './routes/settings.ts'
import { createAuraRouter } from './routes/aura.ts'
import { AuraIndexer } from './services/aura/indexer.ts'
import { AuraQueryService } from './services/aura/graph.ts'
import { WorkspaceService } from './services/workspace.ts'
import { TerminalService } from './services/terminal.ts'
import { ManagedShellService } from './services/managedShell.ts'
import { createManagedShellRouter } from './routes/managedShell.ts'
import { TaskService } from './services/task.ts'
import { createTasksRouter } from './routes/tasks.ts'
import { WebSocketServer } from 'ws'

const PORT = parseInt(process.env.PORT ?? '3001', 10)
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const DATA_DIR = join(process.cwd(), 'data')

async function start() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '10mb' }))

  const store = new FileStore(DATA_DIR)
  await store.init()

  // Auto-detect first available model from Ollama
  let detectedModel = 'llama3.2'
  try {
    const availableModels = await ollama.listModels()
    if (availableModels.length > 0) {
      detectedModel = availableModels[0].name
    }
  } catch {
    // Ollama not running yet, use fallback
  }

  const defaultSettings = {
    defaultModel: detectedModel,
    contextWindowSize: 131072,
    autoExtractMemory: true,
    preferences: {
      responseDetail: null, technicalLevel: null, responseFormat: null,
      domains: null, personality: null, proactiveness: null,
      languageStyle: null, useOfExamples: null,
    },
    preferencesSet: false,
    activeSkillIds: [],
    defaultProjectPath: null,
    defaultProjectModel: null,
    defaultEmbeddingModel: null,
    ollamaBaseUrl: '',
    ollamaApiKey: '',
  }
  const existingSettings = await store.read('settings.json')
  if (!existingSettings) {
    await store.write('settings.json', defaultSettings)
  } else if (!existingSettings.defaultModel) {
    // Fix existing settings with no model
    existingSettings.defaultModel = detectedModel
    await store.write('settings.json', existingSettings)
  }

  const ollama = new OllamaService(OLLAMA_URL)
  const contextService = new ContextService()
  const conversationService = new ConversationService(store)
  const memoryService = new MemoryService(store)
  const webSearch = new WebSearchService()
  const skillsService = new SkillsService(store, webSearch)
  const projectService = new ProjectService(store)
  const groupService = new GroupService(DATA_DIR)
  const workspaceService = new WorkspaceService(projectService)
  const terminalService = new TerminalService(projectService)
  const managedShellService = new ManagedShellService(projectService)
  const taskService = new TaskService(projectService)
  const auraIndexers = new Map<string, AuraIndexer>()
  const auraQueries = new Map<string, AuraQueryService>()
  await skillsService.init()
  await projectService.init()

  app.use('/api/chat', createChatRouter(ollama, contextService, conversationService, memoryService, skillsService, projectService, store))
  app.use('/api/models', createModelsRouter(ollama, store))
  app.use('/api/conversations', createConversationsRouter(conversationService))
  app.use('/api/memory', createMemoryRouter(memoryService))
  app.use('/api/skills', createSkillsRouter(skillsService, ollama, store))
  app.use('/api/projects', createProjectsRouter(projectService, ollama, store))
  app.use('/api/workspace', createWorkspaceRouter(workspaceService))
  app.use('/api/settings', createSettingsRouter(store))
  app.use('/api/aura', createAuraRouter(projectService, auraIndexers, auraQueries, groupService, DATA_DIR, store, managedShellService))
  app.use('/api/managed-shells', createManagedShellRouter(managedShellService))
  app.use('/api/projects', createTasksRouter(taskService))

  app.get('/api/health', async (_req, res) => {
    let ollama = false
    try {
      const settings = await store.read('settings.json') as { ollamaBaseUrl?: string } | null
      const url = settings?.ollamaBaseUrl?.trim() || OLLAMA_URL
      const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
      ollama = resp.ok
    } catch {
      // Ollama not reachable
    }
    res.json({ status: 'ok', ollama })
  })

  const server = app.listen(PORT, () => {
    console.log(`A.U.R.A. backend running on http://localhost:${PORT}`)
    console.log(`Ollama endpoint: ${OLLAMA_URL}`)
  })

  // Single WebSocket server for terminal and file watching
  const wss = new WebSocketServer({ noServer: true })
  const wssFiles = new WebSocketServer({ noServer: true })
  const wssVisual = new WebSocketServer({ noServer: true })

  // Import visual companion helpers for WebSocket handling
  const { addClient: addVisualClient, removeClient: removeVisualClient, recordEvent: recordVisualEvent } = await import('./services/aura/visual-companion.ts')

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://localhost:${PORT}`).pathname

    if (pathname === '/api/terminal') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else if (pathname === '/api/workspace/watch') {
      wssFiles.handleUpgrade(request, socket, head, (ws) => {
        wssFiles.emit('connection', ws, request)
      })
    } else if (pathname.startsWith('/api/aura/visual/') && pathname.endsWith('/ws')) {
      wssVisual.handleUpgrade(request, socket, head, (ws) => {
        wssVisual.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) {
      ws.close(4001, 'projectId required')
      return
    }

    let sessionId: number | null = null

    terminalService.spawn(projectId, ws).then((id) => {
      sessionId = id
    }).catch((err) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }))
      }
      ws.close()
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'stdin' && sessionId !== null) {
          terminalService.write(sessionId, msg.data)
        } else if (msg.type === 'resize' && sessionId !== null) {
          terminalService.resize(sessionId, msg.cols, msg.rows)
        }
      } catch {}
    })

    ws.on('close', () => {
      if (sessionId !== null) {
        terminalService.kill(sessionId)
      }
    })
  })

  // File change watcher WebSocket
  wssFiles.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) {
      ws.close(4001, 'projectId required')
      return
    }

    const unsubscribe = workspaceService.onFileChange(projectId, (_pid, dirPath) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'change', dirPath }))
      }
    })

    const unsubscribeFile = workspaceService.onFileChangeSpecific(projectId, (_pid, filePath) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'file-change', filePath }))
      }
    })

    const unsubscribeGit = workspaceService.onGitStatusChange(projectId, () => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'git-status-change' }))
      }
    })

    workspaceService.startWatching(projectId).catch(() => {})

    ws.on('close', () => {
      unsubscribe()
      unsubscribeFile()
      unsubscribeGit()
      // Stop watching if no more listeners
      const hasOtherClients = Array.from(wssFiles.clients).some((c) => {
        try {
          return (c as any)._projectId === projectId
        } catch { return false }
      })
      if (!hasOtherClients) {
        workspaceService.stopWatching(projectId)
      }
    })

    // Track projectId on the ws instance for cleanup
    ;(ws as any)._projectId = projectId
  })

  // Visual companion WebSocket — live reload and click event recording
  wssVisual.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`)
    const pathname = url.pathname
    // Path format: /api/aura/visual/{projectId}/ws
    const match = pathname.match(/\/api\/aura\/visual\/([^/]+)\/ws/)
    if (!match) {
      ws.close(4001, 'Invalid visual companion WebSocket path')
      return
    }

    // Look up the project path from the companion map using the projectId dir name
    const projectDirName = decodeURIComponent(match[1])
    // Find project by matching workspacePath basename to dirName
    // We'll use a simple approach: iterate known projects
    let projectPath: string | null = null
    try {
      const projects = await projectService.list()
      for (const p of projects) {
        if (basename(p.workspacePath) === projectDirName) {
          projectPath = p.workspacePath
          break
        }
      }
    } catch {}

    if (!projectPath) {
      ws.close(4002, 'Project not found')
      return
    }

    addVisualClient(projectPath, ws)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'click' || msg.type === 'choice') {
          recordVisualEvent(projectPath!, msg).catch(() => {})
        }
      } catch {}
    })

    ws.on('close', () => {
      removeVisualClient(projectPath!, ws)
    })
  })
}

// Catch unhandled errors to prevent server crashes
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
  // Don't exit — keep the server alive
})

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})