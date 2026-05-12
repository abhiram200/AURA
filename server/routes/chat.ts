import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { TOOL_RELAY_INSTRUCTION, TITLE_GENERATE, COMPACTION_PROMPT } from '../prompts.ts'
import { ContextService } from '../services/context.ts'
import type { OllamaService } from '../services/ollama.ts'
import type { ConversationService } from '../services/conversation.ts'
import type { MemoryService } from '../services/memory.ts'
import type { SkillsService } from '../services/skills.ts'
import type { ProjectService } from '../services/project.ts'
import type { FileStore } from '../storage/fileStore.ts'
import type { Settings, ToolCallData, Message } from '../storage/types.ts'
import { isGithubUrl } from '../routes/projects.ts'

type ProjectModeChoice = 'accept' | 'dismiss' | 'open_existing' | 'create_new'
const pendingProjectModeResolvers = new Map<string, (choice: ProjectModeChoice) => void>()

function waitForProjectModeChoice(
  conversationId: string,
  sendSSE: (event: string, data: unknown) => void,
): Promise<ProjectModeChoice> {
  return new Promise((resolve) => {
    let settled = false

    const cleanup = () => {
      clearInterval(keepalive)
      clearTimeout(timeout)
      pendingProjectModeResolvers.delete(conversationId)
    }

    const doResolve = (choice: ProjectModeChoice) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(choice)
    }

    const keepalive = setInterval(() => {
      try { sendSSE('keepalive', {}) } catch { cleanup(); resolve('dismiss') }
    }, 15000)

    const timeout = setTimeout(() => {
      doResolve('dismiss')
    }, 120000)

    pendingProjectModeResolvers.set(conversationId, doResolve)
  })
}

export function createChatRouter(
  ollama: OllamaService,
  contextService: ContextService,
  conversationService: ConversationService,
  memoryService: MemoryService,
  skillsService: SkillsService,
  projectService: ProjectService,
  store: FileStore,
) {
  const router = Router()

  router.post('/project-mode-choice', async (req, res) => {
    const { conversationId, choice } = req.body as {
      conversationId: string
      choice: ProjectModeChoice
    }

    const resolver = pendingProjectModeResolvers.get(conversationId)
    if (resolver) {
      resolver(choice)
      res.json({ ok: true })
    } else {
      res.status(404).json({ error: 'No pending project mode choice for this conversation' })
    }
  })

  router.post('/', async (req, res) => {
    const { conversationId, message, parentId, regenerate, userMsgId, aiMsgId } = req.body as {
      conversationId: string
      message: string
      parentId?: string | null
      regenerate?: boolean
      userMsgId?: string
      aiMsgId?: string
    }

    if (!conversationId) {
      res.status(400).json({ error: 'conversationId is required' })
      return
    }

    if (!message && !regenerate) {
      res.status(400).json({ error: 'message is required' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const conversation = await conversationService.get(conversationId)
      if (!conversation) {
        sendSSE('error', { error: 'Conversation not found' })
        res.end()
        return
      }

      if (conversation.archived) {
        sendSSE('error', { error: 'Cannot send messages to an archived conversation' })
        res.end()
        return
      }

      const settings = await store.read<Settings>('settings.json')
      if (!settings) {
        sendSSE('error', { error: 'Settings not found' })
        res.end()
        return
      }

      let userMessageId: string | undefined
      let userMessage: Message | undefined
      let contextMessages: { role: string; content: string }[]

      if (regenerate) {
        const activePath = parentId
          ? contextService.getActivePath(conversation.messages, parentId)
          : conversation.messages
        const branchSummary = contextService.findSummaryForBranch(conversation.summaries, conversation.activeLeafId, conversation.messages) || conversation.summary
        contextMessages = contextService.assemble(
          activePath,
          message || '',
          settings,
          await memoryService.list(),
          branchSummary,
        )
      } else {
        userMessage = {
          id: userMsgId || uuidv4(),
          role: 'user' as const,
          content: message,
          timestamp: Date.now(),
          parentId: parentId ?? null,
        }
        userMessageId = userMessage.id

        // Don't save user message yet — save both messages as a pair after AI response
        // Use existing conversation messages for context; assemble() adds the newMessage separately
        const activeMessages = parentId
          ? contextService.getActivePath(conversation.messages, parentId)
          : conversation.messages

        const branchSummary = contextService.findSummaryForBranch(conversation.summaries, conversation.activeLeafId, conversation.messages) || conversation.summary
        contextMessages = contextService.assemble(
          activeMessages,
          message,
          settings,
          await memoryService.list(),
          branchSummary,
        )
      }

      const aiMessageParentId = regenerate ? parentId : userMessageId ?? null

      const tools = await skillsService.getActiveDefinitions()

      const stream = await ollama.chatStream({
        model: conversation.model || settings.defaultModel,
        messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        tools: tools.length > 0 ? tools : undefined,
        think: true,
      })

      let fullResponse = ''
      let fullThinking = ''
      let toolCalls: { function: { name: string; arguments: Record<string, unknown> } }[] = []
      const reader = stream.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          const lines = text.split('\n').filter((l) => l.trim())

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              const thinking = parsed.message?.thinking ?? ''
              const content = parsed.message?.content ?? ''

              if (thinking) {
                fullThinking += thinking
                sendSSE('thinking', { content: thinking })
              }

              if (content) {
                fullResponse += content
                sendSSE('token', { content })
              }

              if (parsed.message?.tool_calls) {
                toolCalls = parsed.message.tool_calls
              }
            } catch {
              // Skip malformed lines
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      const toolCallData: ToolCallData[] = []
      const MAX_TOOL_ROUNDS = 5

      let toolMessages: { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]; tool_name?: string }[] = [
        ...contextMessages.map((m) => ({ role: m.role, content: m.content })),
      ]

      let currentToolCalls = toolCalls
      let currentAssistantContent = fullResponse
      let round = 0

      while (currentToolCalls && currentToolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
        toolMessages.push({ role: 'assistant', content: currentAssistantContent, tool_calls: currentToolCalls })

        let projectModeChoice: ProjectModeChoice | null = null
        let projectModeExisting = false
        let projectModeGithub = false
        let openExistingProjectId: string | null = null

        for (const toolCall of currentToolCalls) {
          const skillName = toolCall.function.name
          const args = toolCall.function.arguments
          const toolId = uuidv4()

          sendSSE('tool_call', { id: toolId, name: skillName, args })

          let toolResult: string

          if (skillName === 'project_mode') {
            const existingPath = typeof args === 'object' && args !== null && typeof (args as Record<string, unknown>).path === 'string'
              ? String((args as Record<string, unknown>).path)
              : null
            const projectName = typeof args === 'object' && args !== null && typeof (args as Record<string, unknown>).name === 'string'
              ? String((args as Record<string, unknown>).name)
              : null

            if (existingPath && isGithubUrl(existingPath)) {
              // GitHub URL — check if default project path is set first
              const defaultPath = (settings?.defaultProjectPath as string) || ''
              if (!defaultPath) {
                // No default project path — tell the AI and show modal on client
                sendSSE('project_mode_github_needs_path', { url: existingPath })
                toolResult = 'The default project path is not set. Tell the user they need to set a default project path in Settings before cloning a GitHub repository. Provide clear instructions: go to Settings, set the Default Project Path to a local directory, then try again. The GitHub URL was: ' + existingPath
              } else {
                // Default project path is set — proceed with clone
                sendSSE('project_mode_github', { url: existingPath })
                projectModeGithub = true
                toolResult = 'The GitHub project is being cloned and added to the project builder. Say "Cloning your GitHub project..." and nothing else. Do not generate project code or output.'
              }
            } else if (existingPath) {
              // Local path — add automatically, no modal needed
              sendSSE('project_mode_existing', { path: existingPath })
              projectModeExisting = true
              toolResult = 'The existing project has been added to the project builder. Say "Adding your project to the builder..." and nothing else. Do not generate project code or output.'
            } else if (projectName) {
              // Check if a project with a matching name already exists
              const projects = await projectService.list()
              const nameLower = projectName.toLowerCase()
              const existingProject = projects.find(p =>
                p.name.toLowerCase() === nameLower ||
                p.name.toLowerCase().includes(nameLower) ||
                nameLower.includes(p.name.toLowerCase())
              )

              if (existingProject) {
                // Project exists — ask user whether to open existing or create new
                sendSSE('project_mode_exists', { project: { id: existingProject.id, name: existingProject.name }, newName: projectName })
                const choice = await waitForProjectModeChoice(conversationId, sendSSE)

                if (choice === 'open_existing') {
                  projectModeChoice = 'accept'
                  openExistingProjectId = existingProject.id
                  toolResult = `The user chose to open the existing project "${existingProject.name}". Say "Opening your project..." and nothing else.`
                } else if (choice === 'create_new') {
                  projectModeChoice = 'accept'
                  toolResult = 'The user chose to create a new project. Say "Switching to project mode..." and nothing else.'
                } else {
                  projectModeChoice = 'dismiss'
                  toolResult = 'The user chose to continue in chat mode. Proceed with their original request normally.'
                }
              } else {
                // No match — show normal project mode modal
                sendSSE('project_mode_wait', { name: projectName })
                const choice = await waitForProjectModeChoice(conversationId, sendSSE)
                projectModeChoice = choice

                if (choice === 'accept') {
                  toolResult = 'The user chose to switch to project mode. Say "Switching to project mode..." and nothing else. Do not generate project code or output.'
                } else {
                  toolResult = 'The user chose to continue in chat mode. Proceed with their original request normally. Do not call project_mode again.'
                }
              }
            } else {
              // No name or path — show normal project mode modal
              sendSSE('project_mode_wait', { name: null })
              const choice = await waitForProjectModeChoice(conversationId, sendSSE)
              projectModeChoice = choice

              if (choice === 'accept') {
                toolResult = 'The user chose to switch to project mode. Say "Switching to project mode..." and nothing else. Do not generate project code or output.'
              } else {
                toolResult = 'The user chose to continue in chat mode. Proceed with their original request normally. Do not call project_mode again.'
              }
            }
          } else {
            const skill = await skillsService.findByName(skillName)

            if (!skill) {
              toolResult = `Unknown tool: ${skillName}`
            } else if (skill.handler.type === 'builtin') {
              toolResult = await skillsService.executeBuiltin(skill.handler.action, args)
            } else if (skill.handler.type === 'api') {
              toolResult = await skillsService.executeApi(skill.handler, args)
            } else if (skill.handler.type === 'code') {
              toolResult = await skillsService.executeCode(skill.handler.code, args)
            } else {
              toolResult = `Unsupported handler type: ${skill.handler.type}`
            }
          }

          toolCallData.push({ name: skillName, args, result: toolResult })
          sendSSE('tool_result', { id: toolId, name: skillName, result: toolResult })
          toolMessages.push({ role: 'tool', tool_name: skillName, content: toolResult })
        }

        // If project mode was activated (new or existing), skip follow-up stream and end
        if (projectModeChoice === 'accept' || projectModeExisting || projectModeGithub) {
          sendSSE('token_reset', {})
          if (openExistingProjectId) {
            sendSSE('project_mode_open', { projectId: openExistingProjectId })
          }
          const msg = openExistingProjectId ? 'Opening your project...' : projectModeGithub ? 'Cloning your GitHub project...' : projectModeExisting ? 'Adding your project to the builder...' : 'Switching to project mode...'
          sendSSE('token', { content: msg })
          fullResponse = msg
          break
        }

        toolMessages.push({ role: 'user', content: TOOL_RELAY_INSTRUCTION })

        // Clear previous content before follow-up stream
        sendSSE('token_reset', {})

        const nextStream = await ollama.chatStream({
          model: conversation.model || settings.defaultModel,
          messages: toolMessages,
          stream: true,
          tools: tools.length > 0 ? tools : undefined,
          think: true,
        })

        let nextContent = ''
        let nextThinking = ''
        let nextToolCalls: { function: { name: string; arguments: Record<string, unknown> } }[] = []

        const nextReader = nextStream.getReader()
        const nextDecoder = new TextDecoder()
        try {
          while (true) {
            const { done: nd, value: nv } = await nextReader.read()
            if (nd) break
            const nt = nextDecoder.decode(nv, { stream: true })
            const nlines = nt.split('\n').filter((l) => l.trim())
            for (const nline of nlines) {
              try {
                const np = JSON.parse(nline)
                const nthink = np.message?.thinking ?? ''
                const ncont = np.message?.content ?? ''

                if (nthink) {
                  nextThinking += nthink
                  sendSSE('thinking', { content: nthink })
                }

                if (ncont) {
                  nextContent += ncont
                  sendSSE('token', { content: ncont })
                }

                if (np.message?.tool_calls) {
                  nextToolCalls = np.message.tool_calls
                }
              } catch {
                // Skip malformed lines
              }
            }
          }
        } finally {
          nextReader.releaseLock()
        }

        if (nextThinking) fullThinking += nextThinking
        currentAssistantContent = nextContent
        currentToolCalls = nextToolCalls

        round++
      }

      // After the loop, we have the final text response
      if (round > 0 || toolCalls.length === 0) {
        fullResponse = currentAssistantContent
      }
      sendSSE('token', { content: '', isFinal: true })

      const aiMessage = { id: aiMsgId || uuidv4(), role: 'assistant' as const, content: fullResponse, timestamp: Date.now(), thinking: fullThinking || undefined, toolCalls: toolCallData.length > 0 ? toolCallData : undefined, parentId: aiMessageParentId }

      // Save both user and assistant messages as a pair (single disk write)
      if (userMessage) {
        await conversationService.addMessages(conversationId, [userMessage, aiMessage])
      } else {
        // Regenerate — only save the assistant message
        await conversationService.addMessage(conversationId, aiMessage)
      }

      sendSSE('done', { messageId: aiMessage.id, userMessageId: userMessageId })
      res.end()

      // Background tasks: title generation, compaction, and memory extraction
      ;(async () => {
        try {
          const conv = await conversationService.get(conversationId)
          if (conv && conv.title === 'New Conversation') {
            const titleResponse = await ollama.chat({
              model: conversation.model || settings.defaultModel,
              messages: [
                { role: 'user', content: `${TITLE_GENERATE}\nUser: ${message}\nAssistant: ${fullResponse}` },
              ],
              stream: false,
            })
            const title = titleResponse.message.content.trim().replace(/^["']|["']$/g, '')
            if (title) {
              await conversationService.updateTitle(conversationId, title)
            }
          }
        } catch {
          // Title generation failed, not critical
        }

        try {
          const ctxService = new ContextService()
          // Reserve 20% of context window for response generation
          const compactionThreshold = Math.floor(settings.contextWindowSize * 0.8)
          const conv = await conversationService.get(conversationId)
          if (conv) {
            const activePath = ctxService.getActivePath(conv.messages, conv.activeLeafId ?? null)
            const activeTokens = ctxService.estimateConversationTokens(activePath)

            if (activeTokens > compactionThreshold) {
              const existingSummary = ctxService.findSummaryForBranch(conv.summaries, conv.activeLeafId, conv.messages)

              // Re-compact if no summary exists or tokens have grown past threshold again
              if (!existingSummary || activeTokens > compactionThreshold) {
                const conversationText = activePath.map((m) => `${m.role}: ${m.content}`).join('\n')
                const compactionResponse = await ollama.chat({
                  model: conversation.model || settings.defaultModel,
                  messages: [
                    { role: 'user', content: `${COMPACTION_PROMPT}\n${conversationText}` },
                  ],
                  stream: false,
                })
                const raw = compactionResponse.message.content.trim()
                const workingState = ctxService.parseWorkingState(raw)
                if (workingState) {
                  await conversationService.updateSummary(conversationId, conv.activeLeafId ?? 'default', JSON.stringify(workingState))
                }
              }
            }
          }
        } catch {
          // Compaction failed, not critical
        }

        if (settings.autoExtractMemory) {
          try {
            await memoryService.extractAndSave(
              message,
              fullResponse,
              conversationId,
              async (messages) => {
                const resp = await ollama.chat({
                  model: conversation.model || settings.defaultModel,
                  messages,
                  stream: false,
                })
                return resp.message.content
              },
            )
            await memoryService.compactIfNeeded(async (messages) => {
              const resp = await ollama.chat({
                model: conversation.model || settings.defaultModel,
                messages,
                stream: false,
              })
              return resp.message.content
            })
          } catch {
            // Memory extraction/compaction failed, not critical
          }
        }
      })()
    } catch (err) {
      // Fallback: save the user message even if streaming failed, so it's not lost
      if (userMessage) {
        try { await conversationService.addMessage(conversationId, userMessage) } catch {}
      }
      try { sendSSE('error', { error: err instanceof Error ? err.message : 'Unknown error' }) } catch {}
      try { res.end() } catch {}
    }
  })

  return router
}