export interface ToolCallData {
  name: string
  args: Record<string, unknown>
  result: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  isStreaming?: boolean
  toolCallId?: string
  toolCallName?: string
  thinking?: string
  toolCalls?: ToolCallData[]
  parentId?: string | null
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

export interface Project {
  id: string
  name: string
  description: string
  workspacePath: string
  status: 'active' | 'completed'
  gitUrl?: string
  createdAt: string
  updatedAt: string
}

export interface MemoryEntry {
  id: string
  fact: string
  source: string
  active: boolean
  createdAt: string
}

export interface SkillDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters?: {
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export interface SkillEntry {
  id: string
  name: string
  definition: SkillDefinition
  handler: BuiltinHandler | ApiHandler | CodeHandler
  active: boolean
  locked: boolean
  createdAt: string
}

export interface BuiltinHandler {
  type: 'builtin'
  action: string
}

export interface ApiHandler {
  type: 'api'
  url: string
  method: string
  headers?: Record<string, string>
}

export interface CodeHandler {
  type: 'code'
  code: string
}


export interface Settings {
  defaultModel: string
  contextWindowSize: number
  autoExtractMemory: boolean
  preferences: UserPreferences
  preferencesSet: boolean
  activeSkillIds: string[]
  defaultProjectPath: string | null
  defaultProjectModel: string | null
  defaultEmbeddingModel: string | null
  ollamaBaseUrl: string   // empty = use http://localhost:11434
  codeEditorTheme: string
  autoSave: boolean
}

export interface UserPreferences {
  responseDetail: string | null
  technicalLevel: string | null
  responseFormat: string | null
  domains: string | null
  personality: string | null
  proactiveness: string | null
  languageStyle: string | null
  useOfExamples: string | null
}

export interface OllamaModel {
  name: string
  size: number
  modified_at: string
  isEmbedding?: boolean
}

export interface OllamaChatMessage {
  role: string
  content: string
  tool_calls?: {
    function: {
      name: string
      arguments: Record<string, unknown>
    }
  }[]
  tool_name?: string
}

export interface OllamaChatRequest {
  model: string
  messages: OllamaChatMessage[]
  stream: boolean
  tools?: SkillDefinition[]
  think?: boolean
}

export interface OllamaChatResponse {
  message: {
    role: string
    content: string
    thinking?: string
    tool_calls?: {
      function: {
        name: string
        arguments: Record<string, unknown>
      }
    }[]
  }
  done: boolean
}

export interface OllamaTagsResponse {
  models: OllamaModel[]
}