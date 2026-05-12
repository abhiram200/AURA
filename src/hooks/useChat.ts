import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

export interface ToolCallData {
  name: string
  args: Record<string, unknown>
  result: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
  isThinking?: boolean
  thinking?: string
  toolCalls?: ToolCallData[]
  parentId?: string | null
}

export interface ConversationSummary {
  id: string
  title: string
  model: string
  updatedAt: number
  archived?: boolean
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  summary: string
  summaries?: Record<string, string>
  createdAt: number
  updatedAt: number
  archived?: boolean
  activeLeafId?: string | null
  projectModeAccepted?: boolean
  projectId?: string | null
}

/** Walk backwards from leafId via parentId to get the active path */
export function getActivePath(messages: Message[], leafId: string | null | undefined): Message[] {
  if (!leafId || messages.length === 0) {
    // Fallback: return all messages in order (backward compat for old conversations)
    return messages
  }
  const msgMap = new Map(messages.map(m => [m.id, m]))
  const leaf = msgMap.get(leafId)
  if (!leaf) return messages

  const path: Message[] = []
  let current: Message | undefined = leaf
  while (current) {
    path.unshift(current)
    current = current.parentId ? msgMap.get(current.parentId) : undefined
  }
  return path
}

/** Get sibling messages (same parentId) */
export function getSiblings(messages: Message[], parentId: string | null | undefined): Message[] {
  const normalized = parentId ?? null
  return messages.filter(m => (m.parentId ?? null) === normalized)
}

/** Find the leaf (deepest descendant) from a starting message, following the latest child at each fork */
function findLeaf(messages: Message[], startId: string): string {
  const childrenMap = new Map<string, Message[]>()
  for (const msg of messages) {
    const key = msg.parentId ?? ''
    const children = childrenMap.get(key) ?? []
    children.push(msg)
    childrenMap.set(key, children)
  }

  let currentId = startId
  while (true) {
    const children = childrenMap.get(currentId) ?? []
    if (children.length === 0) break
    currentId = children[children.length - 1].id
  }
  return currentId
}

export function useChat(defaultModel: string = '') {
  const navigate = useNavigate()
  const location = useLocation()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [projectModeSuggested, setProjectModeSuggested] = useState(false)
  const [existingProjectChoice, setExistingProjectChoice] = useState<{ id: string; name: string } | null>(null)
  const [projectModeName, setProjectModeName] = useState<string | null>(null)
  const [pendingGithubUrl, setPendingGithubUrl] = useState<string | null>(null)
  const lastUserMessageRef = useRef<string>('')
  const lastConversationIdRef = useRef<string | null>(null)
  const [newChatRequested, setNewChatRequested] = useState(false)
  const isSendingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations')
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations)
      }
    } catch {
      // Use empty list
    }
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`)
      if (res.ok) {
        const data = await res.json() as Conversation

        // Migrate old conversations: assign parentId and activeLeafId if missing
        const needsMigration = data.messages.length > 0 && data.messages.some(m => m.parentId === undefined)
        if (needsMigration) {
          data.messages = data.messages.map((m, i) => ({
            ...m,
            parentId: i === 0 ? null : data.messages[i - 1].id,
          }))
        }
        if (!data.activeLeafId && data.messages.length > 0) {
          data.activeLeafId = data.messages[data.messages.length - 1].id
        }

        setActiveConversation(data)
        setActiveConversationId(id)
        setNewChatRequested(false)
        navigate(`/chat/${id}`, { replace: true })
      }
    } catch {
      // Load failed
    }
  }, [])

  const startNewConversation = useCallback(() => {
    setActiveConversation(null)
    setActiveConversationId(null)
    setNewChatRequested(true)
    navigate('/', { replace: true })
  }, [])

  const createConversation = useCallback(async (model?: string) => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || defaultModel || undefined }),
      })
      if (res.ok) {
        const conv = await res.json()
        await fetchConversations()
        await loadConversation(conv.id)
        return conv
      }
    } catch {
      // Create failed
    }
    return null
  }, [defaultModel, fetchConversations, loadConversation])

  /** Shared SSE streaming logic */
  const streamResponse = useCallback((
    convId: string,
    body: Record<string, unknown>,
    aiMsgId: string,
    parentIdForAi?: string | null,
  ) => {
    const controller = new AbortController()
    abortControllerRef.current = controller

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error('Chat request failed')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let lastEventType = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              lastEventType = line.slice(7)
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))

                if (lastEventType === 'thinking' && data.content) {
                  setActiveConversation((prev) =>
                    prev
                      ? {
                          ...prev,
                          messages: prev.messages.map((m) =>
                            m.id === aiMsgId
                              ? { ...m, thinking: (m.thinking ?? '') + data.content, isThinking: true }
                              : m
                          ),
                        }
                      : prev
                  )
                } else if (lastEventType === 'token' && data.content && !data.isFinal) {
                  setActiveConversation((prev) =>
                    prev
                      ? {
                          ...prev,
                          messages: prev.messages.map((m) =>
                            m.id === aiMsgId
                              ? { ...m, content: m.content + data.content, isThinking: false }
                              : m
                          ),
                        }
                      : prev
                  )
                } else if (lastEventType === 'token' && data.isFinal) {
                  setActiveConversation((prev) =>
                    prev
                      ? {
                          ...prev,
                          messages: prev.messages.map((m) =>
                            m.id === aiMsgId ? { ...m, isStreaming: false } : m
                          ),
                        }
                      : prev
                  )
                } else if (lastEventType === 'tool_call') {
                  setActiveConversation((prev) =>
                    prev
                      ? {
                          ...prev,
                          messages: prev.messages.map((m) =>
                            m.id === aiMsgId
                              ? { ...m, toolCalls: [...(m.toolCalls ?? []), { name: data.name, args: data.args, result: '' }] }
                              : m
                          ),
                        }
                      : prev
                  )
                } else if (lastEventType === 'project_mode_wait') {
                  const name = (data as { name?: string | null }).name ?? null
                  setProjectModeName(name)
                  setProjectModeSuggested(true)
                } else if (lastEventType === 'project_mode_exists') {
                  const project = (data as { project?: { id: string; name: string } }).project
                  const newName = (data as { newName?: string | null }).newName ?? null
                  setProjectModeName(newName)
                  if (project) {
                    setExistingProjectChoice(project)
                  }
                } else if (lastEventType === 'project_mode_github_needs_path') {
                  // Default project path not set — show modal for user to set it
                  const githubUrl = (data as { url?: string }).url
                  if (githubUrl) {
                    setPendingGithubUrl(githubUrl)
                  }
                } else if (lastEventType === 'project_mode_github') {
                  // Clone a GitHub repo and add to the builder
                  const githubUrl = (data as { url?: string }).url
                  const convId = lastConversationIdRef.current
                  if (githubUrl && convId) {
                    fetch('/api/projects/clone-github', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ url: githubUrl }),
                    })
                      .then(async (res) => {
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({ error: 'Clone failed' }))
                          // Show error in the AI message
                          setActiveConversation((prev) => {
                            if (!prev) return prev
                            const msgs = [...prev.messages]
                            const lastAi = [...msgs].reverse().find(m => m.role === 'assistant')
                            if (!lastAi) return prev
                            return {
                              ...prev,
                              messages: msgs.map(m =>
                                m.id === lastAi.id
                                  ? { ...m, content: m.content + '\n\n⚠️ Clone failed: ' + (err.error || 'Unknown error') }
                                  : m
                              ),
                            }
                          })
                          return
                        }
                        const project = await res.json()
                        fetch(`/api/conversations/${convId}/project`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ projectId: project.id }),
                        }).catch(() => {})
                        setActiveConversation((prev) =>
                          prev ? { ...prev, projectId: project.id } : prev
                        )
                        navigate(`/project-mode/${project.id}`, { state: { conversationId: convId } })
                      })
                      .catch(() => {})
                  }
                } else if (lastEventType === 'project_mode_existing') {
                  // Add existing project to the builder automatically
                  const existingPath = (data as { path?: string }).path
                  const convId = lastConversationIdRef.current
                  if (existingPath && convId) {
                    fetch('/api/projects/add-existing', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workspacePath: existingPath }),
                    })
                      .then(async (res) => {
                        if (!res.ok) return
                        const project = await res.json()
                        // Link project to conversation
                        fetch(`/api/conversations/${convId}/project`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ projectId: project.id }),
                        }).catch(() => {})
                        // Update local conversation state
                        setActiveConversation((prev) =>
                          prev ? { ...prev, projectId: project.id } : prev
                        )
                        navigate(`/project-mode/${project.id}`, { state: { conversationId: convId } })
                      })
                      .catch(() => {})
                  }
                } else if (lastEventType === 'project_mode_open') {
                  const projectId = (data as { projectId?: string }).projectId
                  const convId = lastConversationIdRef.current
                  if (projectId && convId) {
                    fetch(`/api/conversations/${convId}/project`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ projectId }),
                    }).catch(() => {})
                    setActiveConversation((prev) =>
                      prev ? { ...prev, projectId } : prev
                    )
                    navigate(`/project-mode/${projectId}`, { state: { conversationId: convId } })
                  }
                } else if (lastEventType === 'token_reset') {
                  setActiveConversation((prev) =>
                    prev
                      ? {
                          ...prev,
                          messages: prev.messages.map((m) =>
                            m.id === aiMsgId ? { ...m, content: '', thinking: '' } : m
                          ),
                        }
                      : prev
                  )
                } else if (lastEventType === 'tool_result') {
                  setActiveConversation((prev) =>
                    prev
                      ? {
                          ...prev,
                          messages: prev.messages.map((m) =>
                            m.id === aiMsgId
                              ? {
                                  ...m,
                                  toolCalls: (m.toolCalls ?? []).map((tc) =>
                                    tc.name === data.name && !tc.result ? { ...tc, result: data.result } : tc
                                  ),
                                }
                              : m
                          ),
                        }
                      : prev
                  )
                } else if (lastEventType === 'done') {
                  isSendingRef.current = false
                  setIsTyping(false)
                  abortControllerRef.current = null

                  // Mark streaming complete — keep local IDs intact so parentId chain stays consistent
                  // Server IDs are only used when the conversation is reloaded from the server
                  setActiveConversation((prev) => {
                    if (!prev) return prev
                    return {
                      ...prev,
                      messages: prev.messages.map((m) =>
                        m.id === aiMsgId ? { ...m, isStreaming: false, isThinking: false } : m
                      ),
                      activeLeafId: aiMsgId,
                    }
                  })

                  fetchConversations()
                  // Poll for title update
                  if (convId) {
                    let attempts = 0
                    const pollTitle = () => {
                      if (attempts >= 10) return
                      attempts++
                      setTimeout(() => {
                        fetch(`/api/conversations/${convId}`).then(r => r.ok ? r.json() : null).then(data => {
                          if (data && data.title !== 'New Conversation') {
                            setActiveConversation((prev) =>
                              prev && prev.id === convId ? { ...prev, title: data.title } : prev
                            )
                            fetchConversations()
                          } else {
                            pollTitle()
                          }
                        }).catch(() => {})
                      }, 3000)
                    }
                    pollTitle()
                  }
                } else if (lastEventType === 'error') {
                  isSendingRef.current = false
                  setIsTyping(false)
                  abortControllerRef.current = null
                  setActiveConversation((prev) =>
                    prev
                      ? {
                          ...prev,
                          messages: prev.messages.map((m) =>
                            m.id === aiMsgId
                              ? { ...m, content: m.content || `Error: ${data.error}`, isStreaming: false }
                              : m
                          ),
                        }
                      : prev
                  )
                }
              } catch {
                // Skip malformed data
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          // User cancelled — mark message as stopped
          isSendingRef.current = false
          setIsTyping(false)
          abortControllerRef.current = null
          setActiveConversation((prev) =>
            prev
              ? {
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === aiMsgId
                      ? { ...m, isStreaming: false, isThinking: false, content: m.content || 'Generation stopped.' }
                      : m
                  ),
                }
              : prev
          )
          return
        }
        isSendingRef.current = false
        setIsTyping(false)
        abortControllerRef.current = null
        setActiveConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: 'Error: Failed to get response from the server.', isStreaming: false }
                    : m
                ),
              }
            : prev
        )
      })
  }, [fetchConversations])

  const sendMessage = useCallback(async (content: string, modelOverride?: string, parentId?: string | null) => {
    if (activeConversation?.archived) return

    isSendingRef.current = true

    // If no active conversation, create one first
    let convId = activeConversationId
    if (!convId) {
      const conv = await createConversation(modelOverride)
      if (!conv) return
      convId = conv.id
      setNewChatRequested(false)
    }

    // Track last user message and conversation for project mode continuation
    lastUserMessageRef.current = content
    lastConversationIdRef.current = convId

    setIsTyping(true)

    // Determine parentId for the user message
    const effectiveParentId = parentId ?? activeConversation?.activeLeafId ?? null

    // Add user message to UI immediately
    const userMsgId = `local-${Date.now()}`
    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      content,
      timestamp: Date.now(),
      parentId: effectiveParentId,
    }
    setActiveConversation((prev) => {
      const base = prev ?? { id: convId!, title: content.slice(0, 50), messages: [], model: defaultModel, summary: '', createdAt: Date.now(), updatedAt: Date.now() }
      return { ...base, messages: [...base.messages, userMsg], activeLeafId: userMsgId }
    })

    // Add placeholder AI message
    const aiMsgId = `ai-${Date.now()}`
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      parentId: userMsgId,
    }
    setActiveConversation((prev) =>
      prev ? { ...prev, messages: [...prev.messages, aiMsg], activeLeafId: aiMsgId } : prev
    )

    // Stream response — send client-generated IDs so server uses them instead of generating new ones
    streamResponse(convId!, { conversationId: convId, message: content, parentId: effectiveParentId, userMsgId, aiMsgId }, aiMsgId, userMsgId)
  }, [activeConversation, activeConversationId, createConversation, defaultModel, streamResponse])

  /** Stop the current generation */
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  /** Switch to a different branch at a message position */
  const switchBranch = useCallback((messageId: string) => {
    setActiveConversation((prev) => {
      if (!prev) return prev
      const newLeafId = findLeaf(prev.messages, messageId)
      return { ...prev, activeLeafId: newLeafId }
    })
  }, [])

  /** Edit a user message: creates a sibling with new content and regenerates */
  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    if (!activeConversation || activeConversation.archived) return

    const msgIndex = activeConversation.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) return

    const originalMsg = activeConversation.messages[msgIndex]
    if (originalMsg.role !== 'user') return

    isSendingRef.current = true
    setIsTyping(true)

    // Create new user message as a sibling (same parentId)
    const newUserMsgId = `local-${Date.now()}`
    const newUserMsg: Message = {
      id: newUserMsgId,
      role: 'user',
      content: newContent,
      timestamp: Date.now(),
      parentId: originalMsg.parentId ?? null,
    }

    // Create placeholder AI message
    const aiMsgId = `ai-${Date.now()}`
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      parentId: newUserMsgId,
    }

    setActiveConversation((prev) => {
      if (!prev) return prev
      const updated = {
        ...prev,
        messages: [...prev.messages, newUserMsg, aiMsg],
        activeLeafId: aiMsgId,
      }
      return updated
    })

    streamResponse(activeConversation.id, {
      conversationId: activeConversation.id,
      message: newContent,
      parentId: originalMsg.parentId ?? null,
      userMsgId: newUserMsgId,
      aiMsgId,
    }, aiMsgId, newUserMsgId)
  }, [activeConversation, streamResponse])

  /** Regenerate the last AI response (or a specific AI message) */
  const regenerateResponse = useCallback(async (aiMessageId?: string) => {
    if (!activeConversation || activeConversation.archived) return

    // Find the AI message to regenerate
    const activePath = getActivePath(activeConversation.messages, activeConversation.activeLeafId)
    let targetAiMsg: Message | undefined
    if (aiMessageId) {
      targetAiMsg = activeConversation.messages.find(m => m.id === aiMessageId)
    } else {
      // Default: regenerate the last AI message in the active path
      targetAiMsg = [...activePath].reverse().find(m => m.role === 'assistant')
    }
    if (!targetAiMsg) return

    // Find the parent user message
    const parentUserMsg = activeConversation.messages.find(m => m.id === targetAiMsg!.parentId)
    if (!parentUserMsg) return

    isSendingRef.current = true
    setIsTyping(true)

    // Create a new sibling AI message (same parentId as the original)
    const aiMsgId = `ai-${Date.now()}`
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      parentId: parentUserMsg.id,
    }

    setActiveConversation((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        messages: [...prev.messages, aiMsg],
        activeLeafId: aiMsgId,
      }
    })

    streamResponse(activeConversation.id, {
      conversationId: activeConversation.id,
      message: parentUserMsg.content,
      parentId: parentUserMsg.id,
      regenerate: true,
      aiMsgId,
    }, aiMsgId)
  }, [activeConversation, streamResponse])

  /** Delete a message and all its descendants */
  const deleteMessage = useCallback(async (messageId: string) => {
    if (!activeConversation) return

    // Find all descendants
    const toDelete = new Set<string>()
    const collectDescendants = (parentId: string) => {
      toDelete.add(parentId)
      for (const msg of activeConversation.messages) {
        if (msg.parentId === parentId) {
          collectDescendants(msg.id)
        }
      }
    }
    collectDescendants(messageId)

    const remainingMessages = activeConversation.messages.filter(m => !toDelete.has(m.id))

    // Determine new activeLeafId
    let newLeafId: string | null = null
    if (remainingMessages.length > 0) {
      // Find the last message that's still in the tree (walking from any remaining message to its leaf)
      const lastMsg = remainingMessages[remainingMessages.length - 1]
      newLeafId = findLeaf(remainingMessages, lastMsg.id)
    }

    setActiveConversation((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        messages: remainingMessages,
        activeLeafId: newLeafId,
      }
    })

    // Persist to server
    try {
      await fetch(`/api/conversations/${activeConversation.id}/messages/${messageId}`, { method: 'DELETE' })
      await fetchConversations()
    } catch {
      // Delete failed on server, but UI is already updated
    }
  }, [activeConversation, fetchConversations])

  /** Copy message content to clipboard */
  const copyMessage = useCallback(async (messageId: string) => {
    if (!activeConversation) return
    const msg = activeConversation.messages.find(m => m.id === messageId)
    if (msg) {
      await navigator.clipboard.writeText(msg.content)
    }
  }, [activeConversation])

  /** Retry the last message (re-send after an error) */
  const retryLastMessage = useCallback(() => {
    if (!activeConversation || activeConversation.archived) return

    const activePath = getActivePath(activeConversation.messages, activeConversation.activeLeafId)
    const lastMsg = activePath[activePath.length - 1]
    if (!lastMsg) return

    // If last message is an error AI response, remove it and re-send
    if (lastMsg.role === 'assistant' && lastMsg.content.startsWith('Error:')) {
      // Find the user message before this AI message
      const userMsg = activeConversation.messages.find(m => m.id === lastMsg.parentId)
      if (userMsg) {
        // Remove the error AI message from local state
        setActiveConversation((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            messages: prev.messages.filter(m => m.id !== lastMsg.id),
          }
        })
        // Re-send
        regenerateResponse()
      }
    } else if (lastMsg.role === 'user') {
      // User message was sent but no AI response — just re-send
      sendMessage(lastMsg.content, undefined, lastMsg.parentId)
    }
  }, [activeConversation, regenerateResponse, sendMessage])

  const initializedRef = useRef(false)

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  // On initial load, read URL to decide which conversation to open
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const match = location.pathname.match(/^\/chat\/(.+)$/)
    if (match) {
      loadConversation(match[1])
    }
  }, [loadConversation])

  // Handle browser back/forward via location changes
  useEffect(() => {
    if (isSendingRef.current) return
    const match = location.pathname.match(/^\/chat\/(.+)$/)
    if (match) {
      loadConversation(match[1])
    } else if (location.pathname === '/') {
      setActiveConversation(null)
      setActiveConversationId(null)
      setNewChatRequested(true)
    }
  }, [location.pathname, loadConversation])

  // Cleanup: abort fetch on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const updateConversationModel = useCallback(async (id: string, model: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      if (res.ok) {
        const updated = await res.json()
        setActiveConversation((prev) =>
          prev && prev.id === id ? { ...prev, model: updated.model } : prev
        )
        await fetchConversations()
      }
    } catch {
      // Update failed
    }
  }, [fetchConversations])

  const deleteConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      if (res.ok) {
        if (activeConversationId === id) {
          setActiveConversation(null)
          setActiveConversationId(null)
          setNewChatRequested(true)
          navigate('/', { replace: true })
        }
        await fetchConversations()
      }
    } catch {
      // Delete failed
    }
  }, [activeConversationId, fetchConversations])

  const archiveConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}/archive`, { method: 'PUT' })
      if (res.ok) {
        if (activeConversationId === id) {
          setActiveConversation(null)
          setActiveConversationId(null)
          setNewChatRequested(true)
          navigate('/', { replace: true })
        }
        await fetchConversations()
      }
    } catch {
      // Archive failed
    }
  }, [activeConversationId, fetchConversations])

  const unarchiveConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}/unarchive`, { method: 'PUT' })
      if (res.ok) {
        await fetchConversations()
      }
    } catch {
      // Unarchive failed
    }
  }, [fetchConversations])

  const renameConversation = useCallback(async (id: string, title: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (res.ok) {
        setActiveConversation((prev) =>
          prev && prev.id === id ? { ...prev, title } : prev
        )
        await fetchConversations()
      }
    } catch {
      // Rename failed
    }
  }, [fetchConversations])

  const deleteAllConversations = useCallback(async (archived?: boolean) => {
    try {
      const query = archived === undefined ? '' : `?archived=${archived}`
      const res = await fetch(`/api/conversations${query}`, { method: 'DELETE' })
      if (res.ok) {
        if (archived !== true) {
          setActiveConversation(null)
          setActiveConversationId(null)
          setNewChatRequested(true)
          navigate('/', { replace: true })
        }
        await fetchConversations()
      }
    } catch {
      // Delete all failed
    }
  }, [fetchConversations])

  return {
    conversations,
    activeConversation,
    activeConversationId,
    setActiveConversationId: loadConversation,
    sendMessage,
    isTyping,
    createConversation,
    startNewConversation,
    deleteConversation,
    deleteAllConversations,
    archiveConversation,
    unarchiveConversation,
    renameConversation,
    fetchConversations,
    updateConversationModel,
    // New branching and message actions
    stopGeneration,
    switchBranch,
    editMessage,
    regenerateResponse,
    deleteMessage,
    copyMessage,
    retryLastMessage,
    // Project mode
    projectModeSuggested,
    projectModeName,
    existingProjectChoice,
    pendingGithubUrl,
    dismissGithubPathModal: () => {
      setPendingGithubUrl(null)
    },
    retryGithubClone: async (url: string) => {
      const convId = lastConversationIdRef.current
      if (!convId) return
      setPendingGithubUrl(null)
      try {
        const res = await fetch('/api/projects/clone-github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Clone failed' }))
          // Show error in the conversation
          setActiveConversation((prev) => {
            if (!prev) return prev
            const msgs = [...prev.messages]
            const lastAi = [...msgs].reverse().find(m => m.role === 'assistant')
            if (!lastAi) return prev
            return {
              ...prev,
              messages: msgs.map(m =>
                m.id === lastAi.id
                  ? { ...m, content: m.content + '\n\n⚠️ Clone failed: ' + (err.error || 'Unknown error') }
                  : m
              ),
            }
          })
          return
        }
        const project = await res.json()
        fetch(`/api/conversations/${convId}/project`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id }),
        }).catch(() => {})
        setActiveConversation((prev) =>
          prev ? { ...prev, projectId: project.id } : prev
        )
        navigate(`/project-mode/${project.id}`, { state: { conversationId: convId } })
      } catch {
        // Network error during retry
        setActiveConversation((prev) => {
          if (!prev) return prev
          const msgs = [...prev.messages]
          const lastAi = [...msgs].reverse().find(m => m.role === 'assistant')
          if (!lastAi) return prev
          return {
            ...prev,
            messages: msgs.map(m =>
              m.id === lastAi.id
                ? { ...m, content: m.content + '\n\n⚠️ Clone failed: Network error' }
                : m
            ),
          }
        })
      }
    },
    dismissProjectModeSuggestion: () => {
      setProjectModeSuggested(false)
      setExistingProjectChoice(null)
      setProjectModeName(null)
    },
    acceptProjectMode: () => {
      setProjectModeSuggested(false)
      // Tell the server the user accepted — server will send brief "switching" response
      if (lastConversationIdRef.current) {
        fetch('/api/chat/project-mode-choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: lastConversationIdRef.current, choice: 'accept' }),
        }).catch(() => {})
        fetch(`/api/conversations/${lastConversationIdRef.current}/project-mode`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accepted: true }),
        }).catch(() => {})
      }
      navigate('/project-mode/auto', { state: { prompt: lastUserMessageRef.current, conversationId: lastConversationIdRef.current, projectName: projectModeName } })
    },
    openExistingProject: () => {
      const projectId = existingProjectChoice?.id
      setExistingProjectChoice(null)
      if (lastConversationIdRef.current) {
        fetch('/api/chat/project-mode-choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: lastConversationIdRef.current, choice: 'open_existing' }),
        }).catch(() => {})
        fetch(`/api/conversations/${lastConversationIdRef.current}/project`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        }).catch(() => {})
        setActiveConversation((prev) =>
          prev ? { ...prev, projectId } : prev
        )
        navigate(`/project-mode/${projectId}`, { state: { conversationId: lastConversationIdRef.current } })
      }
    },
    createNewProject: () => {
      setExistingProjectChoice(null)
      if (lastConversationIdRef.current) {
        fetch('/api/chat/project-mode-choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: lastConversationIdRef.current, choice: 'create_new' }),
        }).catch(() => {})
        fetch(`/api/conversations/${lastConversationIdRef.current}/project-mode`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accepted: true }),
        }).catch(() => {})
      }
      navigate('/project-mode/auto', { state: { prompt: lastUserMessageRef.current, conversationId: lastConversationIdRef.current, projectName: projectModeName } })
    },
    continueInChat: () => {
      setProjectModeSuggested(false)
      setExistingProjectChoice(null)
      setProjectModeName(null)
      // Tell the server to continue — server resumes stream with the AI generating normally
      if (lastConversationIdRef.current) {
        fetch('/api/chat/project-mode-choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: lastConversationIdRef.current, choice: 'dismiss' }),
        }).catch(() => {})
        fetch(`/api/conversations/${lastConversationIdRef.current}/project-mode`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accepted: false }),
        }).catch(() => {})
      }
    },
  }
}