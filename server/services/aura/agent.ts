import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { platform } from 'os'
import type { Response } from 'express'
import type { AuraQueryService } from './graph.ts'
import type { AgentEventSink } from './sse.ts'
import { AgentEventType } from './sse.ts'
import type { ManagedShellService } from '../managedShell.ts'
import { SilentEventSink } from './sse.ts'
import { WebSearchService } from './web-search.ts'
import { PlanPersistenceService, type SavedPlan } from './plan-persistence.ts'
import { BUILDER_COMPACTION_PROMPT } from '../../prompts.ts'
import type { AuraChatService, CompactionCheckpoint } from '../aura-chat.ts'
import { writeScreen, readEvents as readVisualEvents, startVisualCompanion, stopVisualCompanion } from './visual-companion.ts'

const execFileAsync = promisify(execFile)

// ── Token estimation ────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_WINDOW = 200_000
const MESSAGE_OVERHEAD_TOKENS = 10 // Per-message structural overhead (role labels, framing)
const COMPACTION_TOOL_RESULTS = new Set(['write', 'update', 'ask_user', 'dispatch_sub_agents'])

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function estimateMessagesTokens(messages: Array<{ role: string; content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }>): number {
  return messages.reduce((sum, m) => {
    let tokens = MESSAGE_OVERHEAD_TOKENS + estimateTokens(m.content)
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        tokens += estimateTokens(tc.function.name)
        tokens += estimateTokens(JSON.stringify(tc.function.arguments))
      }
    }
    return sum + tokens
  }, 0)
}

// ── Context compaction ──────────────────────────────────────────────────────

const COMPACT_THRESHOLD = 0.7 // Compact when tokens exceed 70% of context window
const RECENT_BUDGET_RATIO = 0.3 // Keep 30% of context window for recent messages
const COMPACTION_FAILURE_LIMIT = 3 // Stop compacting after this many consecutive failures

// Group messages into turn units: each turn = [assistant(+tool_calls), ...tool results, next user message?]
function groupMessagesIntoTurns(messages: OllamaMessage[]): OllamaMessage[][] {
  const turns: OllamaMessage[][] = []
  let currentTurn: OllamaMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]

    // System messages are their own group (not part of a turn)
    if (m.role === 'system') {
      if (currentTurn.length > 0) {
        turns.push(currentTurn)
        currentTurn = []
      }
      turns.push([m])
      continue
    }

    currentTurn.push(m)

    // A turn boundary is after a user message that follows assistant+tool results,
    // or after an assistant message with no tool calls
    const isAssistantWithToolCalls = m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0
    const isToolResult = m.role === 'tool'
    const isUserMessage = m.role === 'user'

    if (isUserMessage) {
      // User message ends the current turn
      turns.push(currentTurn)
      currentTurn = []
    } else if (!isAssistantWithToolCalls && !isToolResult && m.role === 'assistant') {
      // Assistant with no tool calls — standalone turn
      turns.push(currentTurn)
      currentTurn = []
    }
    // Otherwise (assistant with tool_calls, or tool result), continue accumulating
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  return turns
}

// Build the conversation text to send to the compaction LLM,
// including only allowed tool results
function buildCompactionInput(messages: OllamaMessage[]): string {
  const lines: string[] = []

  for (const m of messages) {
    if (m.role === 'system') continue // Skip system messages in the summary input

    if (m.role === 'user') {
      lines.push(`[User]: ${m.content}`)
    } else if (m.role === 'assistant') {
      if (m.content) {
        lines.push(`[Assistant]: ${m.content}`)
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        const callDescs = m.tool_calls.map(tc => {
          const argsStr = JSON.stringify(tc.function.arguments)
          const abbreviated = argsStr.length > 100 ? argsStr.slice(0, 100) + '...' : argsStr
          return `${tc.function.name}(${abbreviated})`
        })
        lines.push(`[Assistant called]: ${callDescs.join(', ')}`)
      }
    } else if (m.role === 'tool') {
      const toolName = m.name || 'unknown'
      if (COMPACTION_TOOL_RESULTS.has(toolName)) {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        lines.push(`[Tool result (${toolName})]: ${content}`)
      } else {
        lines.push(`[Tool result (${toolName})]: <omitted>`)
      }
    }
  }

  return lines.join('\n')
}

// Fallback: rule-based summary when LLM compaction fails
function buildFallbackSummary(
  messages: OllamaMessage[],
  todoList: AuraTodoItem[],
  planResume?: PlanResumeContext | null,
): string {
  let summary = '## Previous Work (Compacted)\n\nThe earlier part of this conversation has been summarized to save context space.\n\nKey completed work:\n'

  if (planResume) {
    const pending = planResume.todos.filter(t => t.status !== 'completed')
    summary += `\nContinuing plan "${planResume.slug}". ${planResume.todos.filter(t => t.status === 'completed').length}/${planResume.todos.length} tasks done. Next: "${planResume.nextTask || 'none'}".\n`
  }

  for (const m of messages) {
    if (m.role === 'user') {
      const snippet = m.content.slice(0, 200).trim()
      if (snippet) summary += `- User asked: ${snippet}\n`
    }
    if (m.role === 'assistant') {
      if (m.content) {
        const snippet = m.content.slice(0, 300).trim()
        if (snippet) summary += `- Assistant: ${snippet}\n`
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        const callDescs = m.tool_calls.map(tc => `${tc.function.name}(${JSON.stringify(tc.function.arguments).slice(0, 80)})`)
        summary += `  Called: ${callDescs.join(', ')}\n`
      }
    }
    if (m.role === 'tool') {
      const toolName = m.name || 'unknown'
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      if (content.startsWith('{"acknowledged":true')) continue
      const isErrored = content.toLowerCase().includes('error')
      const limit = isErrored ? 300 : 150
      const snippet = content.slice(0, limit).trim()
      if (snippet) summary += `  (tool result ${toolName}: ${snippet}...)\n`
    }
  }

  if (todoList.length > 0) {
    summary += '\n## Current Task List\n'
    for (const t of todoList) {
      const status = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]'
      summary += `${status} ${t.subject} — ${t.description}\n`
    }
    const pending = todoList.filter(t => t.status !== 'completed')
    if (pending.length > 0) {
      summary += `\nContinue with the next pending task: "${pending[0].subject}". Steps marked [x] are already done — do not redo them.`
    } else {
      summary += '\nAll tasks are completed.'
    }
  }

  return summary
}

// Call Ollama for AI-generated compaction summary
async function generateCompactionSummary(
  messages: OllamaMessage[],
  todoList: AuraTodoItem[],
  ollamaBaseUrl: string,
  model: string,
  planResume?: PlanResumeContext | null,
): Promise<string | null> {
  const compactionInput = buildCompactionInput(messages)

  // Add todo list and plan resume to the input
  let extraContext = ''
  if (todoList.length > 0) {
    extraContext += '\n\nCurrent task list:\n'
    for (const t of todoList) {
      const status = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]'
      extraContext += `${status} ${t.subject} — ${t.description}\n`
    }
  }
  if (planResume) {
    extraContext += `\n\nActive plan: "${planResume.slug}". ${planResume.todos.filter(t => t.status === 'completed').length}/${planResume.todos.length} tasks done. Next: "${planResume.nextTask || 'none'}".`
  }

  try {
    const res = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: `${BUILDER_COMPACTION_PROMPT}\n${compactionInput}${extraContext}` },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = await res.json() as { message?: { content?: string } }
    const content = data.message?.content?.trim()
    if (!content) return null
    return content
  } catch {
    return null
  }
}

// Compact messages using AI-generated summary (falls back to rule-based on failure)
interface CompactionResult {
  messages: OllamaMessage[]
  compactionFailures: number
  /** If compaction happened: checkpoint data to persist. null if no compaction. */
  checkpoint: {
    summary: string
    aiGenerated: boolean
    summaryTokens: number
  } | null
}

async function compactMessagesAsync(
  messages: OllamaMessage[],
  systemPrompt: string,
  todoList: AuraTodoItem[],
  contextWindow: number,
  ollamaBaseUrl: string,
  model: string,
  compactionFailures: number,
  planResume?: PlanResumeContext | null,
): Promise<CompactionResult> {
  const totalTokens = estimateTokens(systemPrompt) + estimateMessagesTokens(messages)
  if (totalTokens <= contextWindow * COMPACT_THRESHOLD) {
    return { messages, compactionFailures, checkpoint: null } // No compaction needed
  }

  // Circuit breaker: stop compacting after too many consecutive failures
  if (compactionFailures >= COMPACTION_FAILURE_LIMIT) {
    return { messages, compactionFailures, checkpoint: null }
  }

  // Group messages into turns (preserving tool-call/result pairs)
  const turns = groupMessagesIntoTurns(messages)

  // The first turn should be the system message — keep it always
  const systemTurn = turns[0] // [system message]
  const conversationTurns = turns.slice(1)

  // Walk backward through conversation turns, keeping complete turns that fit in the budget
  const recentTokenBudget = Math.floor(contextWindow * RECENT_BUDGET_RATIO)
  let usedTokens = 0
  let cutoffIndex = conversationTurns.length // Index where we start keeping turns

  for (let i = conversationTurns.length - 1; i >= 0; i--) {
    const turnTokens = estimateMessagesTokens(conversationTurns[i])
    if (usedTokens + turnTokens > recentTokenBudget) {
      break
    }
    usedTokens += turnTokens
    cutoffIndex = i
  }

  // Turn-boundary safety: always keep at least the most recent turn, even if it exceeds the budget.
  // We never split a turn — it must stay intact (tool call/result pairs cannot be separated).
  if (cutoffIndex >= conversationTurns.length) {
    cutoffIndex = Math.max(0, conversationTurns.length - 1)
  }

  const recentTurns = conversationTurns.slice(cutoffIndex)
  const removedTurns = conversationTurns.slice(0, cutoffIndex)

  if (removedTurns.length === 0) {
    return { messages, compactionFailures, checkpoint: null } // Nothing to compact
  }

  const removedMessages = removedTurns.flat()
  const recentMessages = recentTurns.flat()

  // Try AI-generated summary first
  let summary: string | null = await generateCompactionSummary(
    removedMessages, todoList, ollamaBaseUrl, model, planResume,
  )

  const aiGenerated = summary !== null
  let newFailures = compactionFailures
  if (summary === null) {
    newFailures++
    // Fall back to rule-based summary
    summary = buildFallbackSummary(removedMessages, todoList, planResume)
  } else {
    newFailures = 0 // Reset on success
  }

  // Determine summary role: avoid consecutive user messages
  const summaryRole = (recentMessages.length > 0 && recentMessages[0].role === 'user')
    ? 'system'
    : 'user'

  const summaryPrefix = summaryRole === 'system' ? '[Conversation Summary]\n\n' : ''
  let summaryContent = `${summaryPrefix}${summary}\n\n---\nThis conversation was compacted. Continue from where you left off without asking the user any further questions.`

  // Summary truncation safeguard: if summary + recent messages + system prompt exceeds the context window,
  // truncate the summary rather than dropping recent messages.
  const recentTokens = estimateMessagesTokens(recentMessages)
  const systemTokens = estimateTokens(systemPrompt)
  const totalAfterCompaction = systemTokens + estimateTokens(summaryContent) + recentTokens
  if (totalAfterCompaction > contextWindow) {
    const maxSummaryTokens = contextWindow - systemTokens - recentTokens - 100 // 100-token margin
    if (maxSummaryTokens > 0) {
      const maxSummaryChars = Math.floor(maxSummaryTokens * CHARS_PER_TOKEN)
      summaryContent = summaryContent.slice(0, maxSummaryChars) + '\n\n[...summary truncated...]'
    }
  }

  const result: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  if (summaryRole === 'system') {
    result.push({ role: 'system', content: summaryContent })
  } else {
    result.push({ role: 'user', content: summaryContent })
  }

  result.push(...recentMessages)

  return {
    messages: result,
    compactionFailures: newFailures,
    checkpoint: {
      summary,
      aiGenerated,
      summaryTokens: estimateTokens(summary),
    },
  }
}

// ── Tool definition types ──────────────────────────────────────────────────

interface AgentTool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
      default?: unknown
      items?: { type: string }
    }>
    required?: string[]
  }
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{
    id?: string
    function: { name: string; arguments: Record<string, unknown> }
  }>
  tool_call_id?: string
  name?: string
}

interface SubAgentTask {
  title: string
  task: string
  focus: string
  type?: SubAgentType
  preContext?: string
}

interface AuraTodoItem {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy?: string[]
}

type SubAgentType = 'explore' | 'research' | 'plan'

const SUB_AGENT_SYSTEM_PROMPTS: Record<SubAgentType, string> = {
  explore: `You are an exploration agent. Investigate the codebase to answer the question. Use tools to find facts — search for symbols, trace dependencies, read files.

## Important Rules

- **ALWAYS end with a text summary**. Your final response MUST contain a clear, structured answer — never end with only tool calls.
- **Cite specifics**: file paths, symbol names, line numbers. Don't be vague.
- **Be concise but complete**. Structure your answer with markdown headings and bullet lists.
- **Do not make any edits** — you are read-only.

Focus on:`,
  research: `You are a research agent. Your job is to find specific, factual information and return a well-structured summary of your findings.

## Research Strategy

1. **Start with the user's question** — identify exactly what information is needed.
2. **Use \`search_web\` with a \`query\`** to find relevant pages when you don't have a URL. Start broad, then narrow down.
3. **Use \`search_web\` with a \`url\`** when you have a specific page to read — this returns the full rendered content.
4. **Use \`read_file\`**, \`search_pattern\`, and \`search\` to cross-reference findings against the local codebase when relevant.
5. **Synthesize after gathering** — once you have enough information, produce your FINAL ANSWER. Do NOT make another tool call after you have the answer.

## Important Rules

- **ALWAYS end with a text summary**. Your final response MUST contain a clear, structured answer — never end with only tool calls.
- **Never say "No findings"**. If search results are sparse, report what you found and note what's missing. Even partial information is better than nothing.
- **Cite sources**. Include URLs or file paths where you found the information.
- **Be specific**. Give version numbers, dates, API signatures, etc. — not vague descriptions.
- **If a search returns no useful results**, try a different query or a different URL before giving up.
- **Structure your response** with markdown headings, bullet points, and code blocks where appropriate.`,
  plan: 'You are a planning agent. Analyze the task, explore the codebase, and produce a step-by-step implementation plan. Your output MUST follow this structured format:\n\n## Implementation Plan\n\n### Step N: [Title]\n- **Files to modify**: [list of file paths]\n- **Changes**: [description of what to change]\n- **Dependencies**: [list of step numbers this depends on, or "none"]\n\nAfter all steps, include:\n### Verification\n- [list of verification steps: build commands, test commands, manual checks]\n\nDo NOT make any edits — only investigate and plan. Be specific: cite exact file paths, function names, and line numbers. The main agent will create a todo list from your plan and execute each step.',
}

const TOOL_ACCESS: Record<SubAgentType, string[]> = {
  explore: ['search', 'context', 'impact', 'dependents', 'dependencies', 'route_map', 'tool_map', 'shape_check', 'api_impact', 'processes', 'process_detail', 'context_manifest', 'context_folder', 'get_graph', 'read_file', 'search_pattern'],
  research: ['search_web', 'context_manifest', 'context_folder', 'read_file', 'search_pattern', 'search'],
  plan: ['search', 'context', 'dependents', 'dependencies', 'context_manifest', 'context_folder', 'read_file', 'search_pattern', 'route_map', 'processes', 'search_web', 'get_graph', 'visual_preview', 'read_visual_events'],
}

// Commands that require user approval before execution, with human-readable descriptions
// These are routed through the approval system instead of being permanently blocked.
const DANGEROUS_COMMAND_DESCRIPTIONS: Array<{ pattern: RegExp; description: string; riskLevel: 'high' | 'medium' }> = [
  { pattern: /\brm\s+-rf\s+\/\b/i, description: 'Recursively delete the root filesystem', riskLevel: 'high' },
  { pattern: /\brm\s+-rf\s+~\b/i, description: 'Recursively delete the home directory', riskLevel: 'high' },
  { pattern: /\bformat\s+[a-z]:/i, description: 'Format a disk drive', riskLevel: 'high' },
  { pattern: /\bdel\s+\/s\b/i, description: 'Recursively delete all files matching a pattern', riskLevel: 'high' },
  { pattern: /\bshutdown\b/i, description: 'Shut down the system', riskLevel: 'high' },
  { pattern: /\breboot\b/i, description: 'Reboot the system', riskLevel: 'high' },
  { pattern: /\bmkfs\b/i, description: 'Create a filesystem (formats a partition)', riskLevel: 'high' },
  { pattern: /\bdd\s+if=/i, description: 'Low-level disk write (can destroy data)', riskLevel: 'high' },
  { pattern: /\b>\s*\/dev\//i, description: 'Redirect output to a device file (can corrupt data)', riskLevel: 'high' },
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/i, description: 'Download and execute a remote script (security risk)', riskLevel: 'high' },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh\b/i, description: 'Download and execute a remote script (security risk)', riskLevel: 'high' },
  { pattern: /\bgit\s+push\s+.*--force\b/i, description: 'Force push to remote, which may overwrite remote history', riskLevel: 'high' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, description: 'Discard all uncommitted changes permanently', riskLevel: 'high' },
  { pattern: /\bgit\s+clean\s+-f\b/i, description: 'Delete untracked files permanently', riskLevel: 'medium' },
  { pattern: /\bgit\s+branch\s+-[dD]\s+main\b/i, description: 'Delete the main branch', riskLevel: 'high' },
  { pattern: /\bgit\s+branch\s+-[dD]\s+master\b/i, description: 'Delete the master branch', riskLevel: 'high' },
  { pattern: /\brm\s+-r\b/i, description: 'Recursively delete a directory', riskLevel: 'medium' },
  { pattern: /\brm\s+-rf\b/i, description: 'Force-recursively delete a directory', riskLevel: 'medium' },
  { pattern: /\bgit\s+push\b/i, description: 'Push commits to remote repository', riskLevel: 'medium' },
  { pattern: /\bgit\s+checkout\s+--\s*\./i, description: 'Discard all uncommitted changes in the working directory', riskLevel: 'medium' },
  { pattern: /\bgit\s+restore\s+--staged\b/i, description: 'Unstage all changes (git restore --staged)', riskLevel: 'medium' },
  { pattern: /\bnpm\s+install\b/i, description: 'Install npm packages (modifies package.json and node_modules)', riskLevel: 'medium' },
  { pattern: /\byarn\s+add\b/i, description: 'Add a yarn package (modifies package.json)', riskLevel: 'medium' },
  { pattern: /\bpip\s+install\b/i, description: 'Install a Python package', riskLevel: 'medium' },
  { pattern: /\bcargo\s+add\b/i, description: 'Add a Rust crate dependency', riskLevel: 'medium' },
  { pattern: /\bgit\s+merge\b/i, description: 'Merge a branch into the current branch', riskLevel: 'medium' },
  { pattern: /\bgit\s+rebase\b/i, description: 'Rebase the current branch onto another branch', riskLevel: 'medium' },
]

// ── Approval system ────────────────────────────────────────────────────────

interface ApprovalResult {
  approved: boolean
  reason?: string
  feedback?: string
}

interface ApprovalRequest {
  id: string
  type: 'command' | 'plan' | 'question'
  command?: string
  description?: string
  riskLevel?: 'high' | 'medium'
  cwd?: string
  planMarkdown?: string
  question?: string
  options?: string[]
}

interface PlanResumeContext {
  slug: string
  originalPrompt: string
  todos: AuraTodoItem[]
  nextTask: string | null
}

// All approval patterns are now in DANGEROUS_COMMAND_DESCRIPTIONS above

class ApprovalManager {
  private pending: Map<string, { resolve: (result: ApprovalResult) => void; timeout: NodeJS.Timeout }> = new Map()

  async requestApproval(id: string, eventSink: AgentEventSink, type: 'command' | 'plan' | 'question', details: Record<string, unknown>): Promise<ApprovalResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        resolve({ approved: false, reason: 'Approval request timed out (5 minutes)' })
      }, 300000) // 5 minute timeout

      this.pending.set(id, { resolve, timeout })
      eventSink.emit('approval_request' as any, { id, type, ...details })
    })
  }

  resolve(id: string, result: ApprovalResult): boolean {
    const entry = this.pending.get(id)
    if (!entry) return false
    clearTimeout(entry.timeout)
    this.pending.delete(id)
    entry.resolve(result)
    return true
  }
}

// Global approval managers keyed by project path
export const globalApprovalManagers = new Map<string, ApprovalManager>()

// ── Intent detection ───────────────────────────────────────────────────────

function detectIntent(_prompt: string): string[] {
  // On-demand skill loading: aura-guide is always loaded as the base skill.
  // Domain skills (building, exploring, impact, debugging, refactoring, visual)
  // are loaded by the agent via the load_skill tool when it decides it needs them.
  return ['aura-guide']
}

// ── Skill loading ──────────────────────────────────────────────────────────

async function loadSkills(skillNames: string[]): Promise<string> {
  const parts: string[] = []
  for (const name of skillNames) {
    try {
      const skillPath = path.resolve(process.cwd(), 'server', 'skills', name, 'SKILL.md')
      const content = await fs.readFile(skillPath, 'utf-8')
      parts.push(content)
    } catch {
      // Skill file not found, skip
    }
  }
  return parts.join('\n\n---\n\n')
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(skillContent: string, contextSection?: string, isGreenfield?: boolean, gitContext?: string, planResume?: PlanResumeContext, isWindows?: boolean): string {
  const greenfieldNote = isGreenfield
    ? '\nThis is a NEW project with no existing code. You are building from scratch.\n\n**IMPORTANT: Your FIRST actions must be:**\n1. Initialize git: `git init`\n2. Create a proper `.gitignore` file — always include `.aura/*` plus appropriate entries for the project type (e.g., node_modules/, dist/, .env for Node.js; __pycache__/, .venv/, *.pyc for Python; etc.)\n3. Commit: `git add -A` then `git commit -m "chore: initial commit"`\n4. Create a feature branch: `git checkout -b aura/<short-description>`\n\nThen: if the user\'s request is vague, use `ask_user` to clarify requirements (technology choices, UI preferences, scope, etc.) before planning. If the task involves UI/layout decisions, use `visual_preview` to show mockups and get visual feedback — users often can\'t articulate design preferences in words alone. If you need external knowledge (library APIs, framework setup, versions), dispatch a `research` sub-agent. After that, dispatch a `plan` sub-agent — include any user decisions and visual preferences as `preContext`. No explore sub-agent needed since there is no existing codebase.\n'
    : '\nThis is an existing codebase. You MUST explore it before making any changes. Start by dispatching an `explore` sub-agent to understand the structure, patterns, and relevant files.\n'

  const gitNote = gitContext ? `\n${gitContext}\n` : ''

  return `You are AURA (Artificial Unified Responsive Assistant) — a builder agent connected to the user's codebase. Your primary role is to CREATE and BUILD: scaffolding projects, implementing features, fixing bugs, and refactoring code. You can also investigate and answer questions about the codebase when asked.
${greenfieldNote}${gitNote}
## How to Build

For any task that requires more than one file change, follow this workflow IN ORDER:

1. **Explore first.** Dispatch an \`explore\` sub-agent to understand the codebase structure, relevant files, and existing patterns. You cannot plan effectively without understanding what already exists.
2. **Research if needed.** If the task requires external knowledge (APIs, libraries, frameworks, versions), dispatch a \`research\` sub-agent. Skip this step if not needed.
3. **Clarify and visualize.** If the user's request is vague or you have ambiguities about requirements, clarify BEFORE planning. Choose the right tool for the type of question:
   - **Use \`ask_user\`** for: technology choices, scope decisions, feature priorities, API design, data modeling, any question where the answer is words or a selection from options.
   - **Use \`visual_preview\`** for: UI mockups, wireframes, layout comparisons, architecture diagrams, flow diagrams, side-by-side design choices, visual hierarchy questions — anything where SEEING it is clearer than DESCRIBING it.
   - **The test:** Would the user understand this better by seeing it than reading about it? If yes, use \`visual_preview\`. If no, use \`ask_user\`. Many tasks benefit from BOTH — ask text questions first, then show visual options.
   - **After calling \`visual_preview\`, do NOT describe the visual content in your response.** The user can see it in the Visual tab. Just tell them the preview is ready and what to look for or select.
   - **After pushing a visual preview, STOP and wait for the user to send a new message.** Do NOT call \`read_visual_events\` in the same response — the events file is cleared when a new screen is pushed, so an immediate read will always return empty. Only call \`read_visual_events\` after the user responds, giving them time to click options in the browser. If \`read_visual_events\` returns empty, ask the user to interact with the preview and wait — never randomly choose an option.
   - When visual decisions are complete, call \`close_visual\` to close the Visual tab. Don't leave it open after the task is done.
   - **Never skip clarifying questions.** If the request is vague, ask or show options before planning.
4. **Plan.** Dispatch a \`plan\` sub-agent to create a detailed implementation plan. Include discoveries from explore/research steps, user decisions from \`ask_user\`, and visual preferences from \`read_visual_events\` as \`preContext\`. If the task has visual components, include mockup descriptions in the plan so the user can confirm the visual direction before code is written.
5. **Create a feature branch.** Use the \`git\` tool: \`git checkout -b aura/short-description\`
6. **Create a todo list.** After receiving the plan, immediately call \`todo_write\` to create a structured task list. Break the plan into discrete, ordered steps.
7. **Work through todos sequentially.** For each todo:
   a. Mark it \`in_progress\` via \`todo_write\`
   b. Make the necessary file changes (using \`write\` for new files, \`update\` for existing)
   c. **Verify and commit** — this is a single combined step:
      i. Run build/test commands via \`execute\` to verify changes compile and pass tests
      ii. Read modified files back via \`read_file\` to confirm correctness
      iii. Commit via the \`git\` tool: first \`git add -A\`, then \`git commit -m "type: description"\`
   d. Mark it \`completed\` via \`todo_write\`
   e. **When all todos are completed**, call \`close_visual\` to close the Visual tab if it was opened during this task.

**Deploy sub-agents sequentially** — explore first, then research (if needed), then plan. Each step builds on the previous one. Only dispatch multiple sub-agents in a single call when they are genuinely independent (e.g., exploring two unrelated codebase areas simultaneously).

For quick fixes (single file, obvious change): skip the plan, just fix it directly.

## When to Use Sub-Agents vs Direct Tool Calls

- **Use sub-agents** for any task that requires understanding, investigating, or modifying multiple areas of the codebase. If a task involves reading multiple files, tracing relationships, or researching something you don't already know — spawn a sub-agent. This keeps your context window clean.
- **Use direct tool calls** only for quick single operations where you already know exactly what to do (read one file, write one file, check one symbol).
- **Deploy sub-agents sequentially for build tasks**: explore → research (if needed) → plan. Each step builds on the previous one. Deploy them one at a time so later steps can use discoveries from earlier steps via \`preContext\`.
- Only dispatch multiple sub-agents in a single \`dispatch_sub_agents\` call when they are genuinely independent (e.g., exploring two unrelated codebase areas at the same time).
- **Avoid over-splitting**: combine related investigations into a single sub-agent with a comprehensive task description. But don't lump unrelated concerns together either.

## Sub-Agents

Use \`dispatch_sub_agents\` to offload token-heavy tasks — exploration, research, planning — to sub-agents. This keeps your own context window clean and avoids bloating it with intermediate tool results.

**Writing effective task descriptions:**
- Be specific and detailed. A sub-agent only knows what you tell it — it starts with no conversation context.
- Include relevant file paths, symbol names, function signatures, or error messages directly in the \`task\` field.
- State exactly what you want the sub-agent to find, trace, or produce — vague prompts waste iterations.
- Bad: "Look at the auth module"
- Good: "Trace how login() in src/auth.ts is called from the API layer. Find all routes that import or call login(), check what parameters it takes, and identify any middleware that wraps it. Report the call chain from route handler → middleware → login() → token generation."

**Using \`preContext\`:**
- When you have already discovered relevant facts (file paths, symbols, relationships, error details), pass them via \`preContext\` so the sub-agent doesn't waste time re-discovering them.
- Only include context that is directly relevant to the task. Don't dump everything you know — distill it to what the sub-agent actually needs.

**Choosing the right type:**
- **explore**: Investigate code — find symbols, trace dependencies, understand architecture. Read-only. **Always use this first for existing codebases** before planning.
- **research**: Look up external info — documentation, APIs, versions, examples via web search. Use after exploring if the task requires external knowledge.
- **plan**: Analyze and plan — produce a structured implementation plan. **Use after exploring (and researching if needed)** so the plan is grounded in actual codebase knowledge. Pass discoveries as \`preContext\`.

**When you should spawn sub-agents (not do the work inline):**
- Any investigation that would require multiple tool calls — offload it so the intermediate results don't fill your context
- Understanding unfamiliar code before making changes
- Investigating a bug that spans multiple files
- Researching how a feature is implemented before modifying it

## Running Commands

Use the \`execute\` tool to run build, test, and lint commands — NEVER use it for git operations. Always verify changes by:
1. Running relevant build/test commands after editing files
2. Reading the modified files back to confirm correctness
3. If a fix fails, try a different approach — never repeat the same edit

## Background Shell Management

Tools: \`shell_spawn\`, \`shell_read\`, \`shell_terminate\`, \`shell_list\`.

**When to use which:**
- \`execute\` — quick commands that finish in seconds (git status, ls, cat)
- \`shell_spawn\` — long-running commands (dev servers, builds, test suites, watchers)

**Rules:**
1. **No duplicates.** Before \`shell_spawn\`, run \`shell_list\`. If a shell with the same command is already running, \`shell_terminate\` it first.
2. **Verify dependencies.** Before starting work that depends on a shell, use \`shell_read\` to confirm it exited with code 0. Do not assume success just because you spawned it.
3. **Verify termination.** After \`shell_terminate\`, confirm the process is actually dead (see verification guide below). If still alive, kill it directly with \`execute\` (${isWindows ? '`taskkill /F /PID <pid>`' : '`kill -9 <pid>`'}) and re-check.
4. **Descriptive names.** Use names like "dev-server", "install-deps", "run-tests" — not "shell1".

### Verifying Server Status

When checking whether a server is running (after spawning, after terminating, or when asked), follow these steps in order. Do NOT skip steps or assume default ports.

**Step 1 — Find the port from project config.** ALWAYS read the config files below before checking ports. Do NOT assume default ports — most projects customize their port.

Read ALL of these files that exist in the project using \`read_file\`:
1. \`package.json\` — find the "scripts" section to identify the framework and any \`--port\`/\`-p\`/\`PORT=\` flags
2. The framework config file (read the one that exists):
   - Vite: \`vite.config.ts\` or \`vite.config.js\` → look for \`server.port\`
   - Next: \`next.config.js\` or \`next.config.mjs\` → look for \`port\`
   - Nest: \`nest-cli.json\` or \`src/main.ts\` → look for \`port\`
   - Webpack: \`webpack.config.js\` or \`webpack.config.ts\` → look for \`devServer.port\`
3. \`.env\` and \`.env.development\` → look for \`PORT=\`

The port comes from whichever file defines it. Priority: CLI flags in package.json > framework config > .env > framework default.

Example: A Vite project has \`"dev": "vite"\` in package.json (no port flag). The port is defined in \`vite.config.ts\` under \`server: { port: 5555 }\`. You MUST read \`vite.config.ts\` to find it — the default Vite port (5173) would be WRONG here.

**Step 2 — Check if the process is alive** (most reliable method):
${isWindows
? 'Use: `tasklist /FI "PID eq <pid>"` (get PID from `shell_list`)'
: 'Use: `ps -p <pid> -o pid,comm`'}

Process alive → server is running. Process gone → server is dead, regardless of port state.

**Step 3 — Confirm with a port check** (optional, for certainty):
${isWindows
? '- `netstat -ano | findstr :<port> | findstr LISTENING`\n- `curl -s -o NUL -w "%{http_code}" http://localhost:<port>`'
: '- `lsof -i :<port> -P -n`\n- `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>`'}

**Interpreting results:**
- Spawned + process alive → success. Report the port.
- Spawned + process dead → crashed. Check \`shell_read\` for errors.
- Terminated + process still alive → kill directly (\`${isWindows ? 'taskkill /F /PID <pid>' : 'kill -9 <pid>'}\`), then re-check.
- Terminated + process gone → confirmed dead.

## How to Edit Code

1. **Always \`read_file\` before \`update\`.** The \`oldString\` must match exactly — including whitespace and indentation.
2. **Use \`update\` for existing files** — it replaces only the targeted text and preserves everything else.
3. **Use \`write\` for new files** or when replacing an entire file.
4. **Include enough surrounding context** in \`oldString\` to make it unique in the file.
5. **After editing, check downstream** — use \`search_pattern\` or \`dependents\` to verify nothing is broken.

## Git Workflow

Use the \`git\` tool for all version control operations. Follow this lifecycle for every build task:

### Branch Lifecycle

1. **Start a build** → Create a feature branch from main: \`git checkout -b aura/short-description\`
2. **Work on the build** → Stay on that branch. Commit after each verified todo.
3. **User asks for fixes/edits** → Stay on the same branch. Keep committing.
4. **User says "merge", "ship it", or "looks good"** → Merge the feature branch into main:
   - Switch to main, merge the feature branch
5. **User starts a completely new build** → This means the previous feature is done. Before creating a new branch:
   - Switch to main, merge the current feature branch (fast-forward)
   - Then create the new feature branch from main
6. **Resuming a saved plan** → If the system prompt says "Active plan on branch aura/X", checkout that branch to continue where you left off.

### Commit Discipline

- **Verify then commit.** After each todo: run build/test commands, read back modified files, then commit.
- **Commit messages**: Use conventional commit format — \`feat:\`, \`fix:\`, \`refactor:\`, \`chore:\`, \`docs:\`
- **If staging is empty** (no changes to commit), skip the commit — the todo was already committed or no files changed.

### Reverting Changes

Use the \`git\` tool to undo changes. Pick the right approach:

- **Discard uncommitted changes in working directory**: \`git checkout -- .\` (discards all) or \`git checkout -- <file>\` (specific file)
- **Unstage staged changes**: \`git restore --staged .\` or \`git reset HEAD\`
- **Undo the last commit but keep changes**: \`git reset HEAD~1\` (changes become unstaged, ready to re-edit)
- **Undo the last commit and keep changes staged**: \`git reset --soft HEAD~1\`
- **Undo the last N commits**: \`git reset HEAD~N\` (replace N with the number)
- **Revert a specific commit (safe, creates new commit)**: \`git revert <hash>\` — use this when you want to undo a commit that's already been pushed or shared
- **Discard everything back to a specific commit**: \`git reset <hash>\` — unstages all commits after that hash but keeps changes in working directory

**Rules for reverting:**
- Prefer \`git revert <hash>\` for shared/pushed commits — it's safe and preserves history
- Use \`git reset HEAD~1\` for local-only commits you want to redo
- NEVER use \`git reset --hard\` or \`git push --force\` without user approval — these are destructive and will trigger a confirmation prompt
- After reverting, run \`git status\` and \`git log --oneline -5\` to confirm the state

### Rules

- **Never force push, reset --hard, or delete main/master branches without user approval** — these will trigger a confirmation prompt
- **Never leave uncommitted work** when switching branches — commit or stash first

## How to Investigate

1. Use tools to gather facts before answering. For complex questions, break them into steps and call tools in sequence.
2. When exploring unfamiliar code, start with \`context_manifest\` → \`context_folder\` for a quick overview, then drill into specific symbols with \`search\` → \`context\`.
3. Always verify claims against actual source code using \`search_pattern\`. The indexed data can have gaps — especially for re-exports, dynamic imports, and CommonJS patterns.
4. When answering "is X used?", "who imports X?", or "is X unused?" — ALWAYS run \`search_pattern\` to confirm, even if the graph shows an answer.

## Limitations

- The dependency graph indexes JavaScript (.js, .jsx, .mjs, .cjs), TypeScript (.ts, .tsx), Python (.py), CSS (.css), SCSS/Sass (.scss, .sass), HTML (.html, .htm), Vue SFC (.vue), PHP (.php), Java (.java), C (.c, .h), C++ (.cpp, .cxx, .cc, .hpp, .hxx, .hh), C# (.cs), Go (.go), Rust (.rs), Less (.less), and Shell (.sh, .bash, .zsh), Dart (.dart), and Kotlin (.kt, .kts) files. For any other language (JSON, Markdown, SQL, XML, YAML, etc.), use \`read_file\`, \`search_pattern\`, and \`search_web\` instead of graph tools.
- If the graph doesn't index the language you're analyzing, say so clearly: "The dependency graph doesn't index [language] files, so I'll use file search and reading instead."

## Folder Context Files

The project has AI-generated context files in \`project_dir/.aura/contexts/\`. Each describes a folder's role, exports, dependencies, and summary in this format:

# <folder-path>
## Role — what the folder does
## Exports — files and what they export
## Dependencies — imports from / imported by
## Summary — human-readable overview

When exploring unfamiliar areas, call \`context_manifest\` first to see all available folders, then \`context_folder\` for specific ones.

## Asking for Approval

Some commands require your approval before they run. When a potentially dangerous command is requested (like \`rm -rf\`, \`npm install\`, \`git push\`, \`git merge\`), the system will pause and show you a confirmation prompt. You can approve or deny these commands.

## Planning Before Building

When you ask the model to build something, it will first create a plan using a planning sub-agent. The plan will be shown to you for review before execution begins. You can:
- **Accept** — proceed with the plan as-is
- **Suggest Edits** — provide feedback and the model will revise the plan

## Clarifying Questions

The model may ask you a clarifying question with predefined options when it needs to make a decision that affects the implementation. Choose the option that best matches your preference.

## How to Respond

- Never mention tools, tool calls, or tool results. Speak as if you personally investigated or built the code.
- Do NOT mention "graph", "dependency graph", or "knowledge graph". Say "the codebase", "the project", or "the code" instead.
- Cite specific symbols, files, and relationships — use inline code for paths (\`src/auth.ts:login\`) and fenced code blocks for snippets.
- Structure your answer with markdown headings, bold, and bullet lists. Don't dump unformatted text.
- Be concise but complete. Prefer specific facts over vague summaries.
- If the user has a node selected (shown under "Current Context" below), acknowledge it at the start of your response.
- When completing a build task, show the todo list progress and summarize what was built.

${planResume ? `\n## Active Plan\n\nYou are continuing build plan: "${planResume.slug}".\nOriginal request: "${planResume.originalPrompt}"\nProgress: ${planResume.todos.filter(t => t.status === 'completed').length}/${planResume.todos.length} tasks done.\n${planResume.nextTask ? `Next task: "${planResume.nextTask}"` : 'All tasks are completed.'}\n\nContinue from where you left off. Do NOT re-do completed steps. Pick up with the next pending or in-progress task.\nIf the user's new message is unrelated to this plan, address their question first, then ask whether they want to continue the plan or consider it complete.\n` : ''}

Node ID format: \`filePath:symbolName\` (e.g., \`src/auth.ts:login\`), or just \`filePath\` for File nodes, or \`filePath:METHOD /path\` for Route nodes.

## Available Skills

Load specialized skill guides by calling \`load_skill\`. Each skill provides tool-specific strategies, safe workflows, and proven patterns. **Load skills at the point you need them** — you don't need all of them upfront.

### When to load (required):
- **\`load_skill("aura-building")\`** — ALWAYS load this at the start of any build/implement task. It contains the build workflow (explore → research → clarify → plan → implement), project scaffolding patterns, and commit conventions.
- **\`load_skill("aura-debugging")\`** — ALWAYS load this when the user reports a bug, error, or unexpected behavior. It contains the systematic debugging workflow (find symbol → trace call chain → read source → verify assumptions).
- **\`load_skill("aura-impact")\`** — ALWAYS load this before making changes to shared/util code, API endpoints, exported functions, or database schemas. It contains impact analysis strategy and risk level thresholds. If you change something others depend on, load this first.
- **\`load_skill("aura-refactoring")\`** — ALWAYS load this when the task involves renaming, moving, extracting, or restructuring existing code. It contains safe rename/extract workflows with verification steps.

### When to load (situational):
- **\`load_skill("aura-exploring")\`** — Load this when you need to investigate an unfamiliar area of the codebase and the graph tools (\`search\`, \`context\`, \`dependents\`, etc.) aren't giving you what you need. It contains the top-down exploration strategy (manifest → folder → symbol → context) and when to use \`search_pattern\` vs \`search\`.
- **\`load_skill("aura-visual")\`** — Load this when you're about to use \`visual_preview\` for the first time in a conversation. It contains the available CSS classes, interaction patterns (options, cards, mockups), and the push → tell → read → iterate workflow. Not needed if you're only doing text-based work.

### When NOT to load:
- Don't load a skill just because it exists. Load it when the task matches its trigger condition.
- Don't load multiple skills at once "just in case." Load the one you need now, and load others if the task evolves.
- Don't re-load a skill you've already loaded in this conversation — you already have its guidance.

${skillContent ? `\n${skillContent}\n` : ''}${contextSection ? `\n## Current Context\n\nThe user is viewing the codebase in their browser. Here is the context from their current view:\n\n${contextSection}\n` : ''}`
}

// ── Context formatting ─────────────────────────────────────────────────────

// Simple glob matching: supports * wildcards and ? single-char
function matchesGlob(str: string, glob: string): boolean {
  const regexStr = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
  return new RegExp(`(^|/)${regexStr}($|/)`).test(str) || new RegExp(regexStr).test(str)
}

function formatContext(context: Record<string, unknown>, maxTokens = 4000): string {
  // Build sections in priority order (highest first)
  // Priority 1: graph overview + selected node
  // Priority 2: selected node context (relationships)
  // Priority 3: explored context (lowest — truncated first)
  const sections: Array<{ priority: number; text: string }> = []

  // Graph overview
  const overview = context.graphOverview as { nodeCount?: number; edgeCount?: number; nodeKinds?: Record<string, number>; edgeTypes?: Record<string, number> } | undefined
  if (overview) {
    const lines: string[] = []
    lines.push('**Graph overview:**')
    lines.push(`- ${overview.nodeCount ?? 0} nodes, ${overview.edgeCount ?? 0} edges`)
    if (overview.nodeKinds && Object.keys(overview.nodeKinds).length > 0) {
      const kinds = Object.entries(overview.nodeKinds).map(([k, v]) => `${k}: ${v}`).join(', ')
      lines.push(`- Node types: ${kinds}`)
    }
    if (overview.edgeTypes && Object.keys(overview.edgeTypes).length > 0) {
      const types = Object.entries(overview.edgeTypes).map(([k, v]) => `${k}: ${v}`).join(', ')
      lines.push(`- Edge types: ${types}`)
    }
    sections.push({ priority: 1, text: lines.join('\n') })
  }

  // Selected node
  const sel = context.selectedNode as { id?: string; name?: string; kind?: string; filePath?: string; range?: { startLine: number; endLine: number } } | null | undefined
  if (sel && sel.id) {
    const lines: string[] = []
    lines.push('**Selected node:**')
    lines.push(`- ${sel.name} (${sel.kind}) in ${sel.filePath}`)
    if (sel.range) lines.push(`- Lines ${sel.range.startLine}-${sel.range.endLine}`)
    lines.push(`- Node ID: ${sel.id}`)
    sections.push({ priority: 1, text: lines.join('\n') })
  }

  // Selected node context (relationships) — now includes node IDs
  const selCtx = context.selectedNodeContext as { incoming?: Array<{ id: string; name: string; kind: string; edgeType: string; filePath: string }>; outgoing?: Array<{ id: string; name: string; kind: string; edgeType: string; filePath: string }>; members?: Array<{ id: string; name: string; kind: string; filePath: string }>; hierarchy?: Array<{ id: string; name: string; kind: string; relation: string }>; containedBy?: { id: string; name: string; kind: string; filePath: string } | null } | null | undefined
  if (selCtx) {
    const lines: string[] = []
    if (selCtx.incoming && selCtx.incoming.length > 0) {
      lines.push('**Incoming references to selected node:**')
      for (const ref of selCtx.incoming.slice(0, 10)) {
        lines.push(`  - ${ref.name} (${ref.kind}) via ${ref.edgeType} — ${ref.filePath} [id: ${ref.id}]`)
      }
      if (selCtx.incoming.length > 10) lines.push(`  - ... and ${selCtx.incoming.length - 10} more`)
    }
    if (selCtx.outgoing && selCtx.outgoing.length > 0) {
      lines.push('**Outgoing references from selected node:**')
      for (const ref of selCtx.outgoing.slice(0, 10)) {
        lines.push(`  - ${ref.name} (${ref.kind}) via ${ref.edgeType} — ${ref.filePath} [id: ${ref.id}]`)
      }
      if (selCtx.outgoing.length > 10) lines.push(`  - ... and ${selCtx.outgoing.length - 10} more`)
    }
    if (selCtx.members && selCtx.members.length > 0) {
      lines.push('**Members of selected node:**')
      for (const m of selCtx.members.slice(0, 15)) {
        lines.push(`  - ${m.name} (${m.kind}) in ${m.filePath} [id: ${m.id}]`)
      }
      if (selCtx.members.length > 15) lines.push(`  - ... and ${selCtx.members.length - 15} more`)
    }
    if (selCtx.hierarchy && selCtx.hierarchy.length > 0) {
      lines.push('**Type hierarchy:**')
      for (const h of selCtx.hierarchy) {
        lines.push(`  - ${h.name} (${h.kind}) — ${h.relation} [id: ${h.id}]`)
      }
    }
    if (selCtx.containedBy) {
      lines.push(`**Contained by:** ${selCtx.containedBy.name} (${selCtx.containedBy.kind}) in ${selCtx.containedBy.filePath} [id: ${selCtx.containedBy.id}]`)
    }
    if (lines.length > 0) {
      sections.push({ priority: 2, text: lines.join('\n') })
    }
  }

  // Explored context — data already available from user's browser session
  const explored = context.exploredContext as { searchResults?: Array<{ id: string; name: string; kind: string; filePath: string; score: number }>; impactResult?: { target: string; downstream: Array<{ id: string; name: string; kind: string; filePath: string; severity: string }>; upstream: Array<{ id: string; name: string; kind: string; filePath: string; severity: string }> } | null; changeDetection?: { filesChanged: number; changedSymbols: Array<{ id: string; name: string; kind: string; filePath: string }> } | null; routeMap?: { routeCount: number; apiCallCount: number; routes: Array<{ id: string; name: string; filePath: string }> } | null; processes?: Array<{ id: string; name: string; method: string; path: string }> | null } | null | undefined
  if (explored) {
    const lines: string[] = []

    if (explored.searchResults && explored.searchResults.length > 0) {
      lines.push('**Recent search results** (already available, no need to re-search):')
      for (const r of explored.searchResults) {
        lines.push(`  - ${r.name} (${r.kind}) in ${r.filePath} [id: ${r.id}]`)
      }
    }

    if (explored.impactResult) {
      const imp = explored.impactResult
      lines.push(`**Impact analysis for ${imp.target}** (already available):`)
      if (imp.downstream.length > 0) {
        lines.push('  Downstream (depends on this):')
        for (const d of imp.downstream) {
          lines.push(`    - ${d.name} (${d.kind}) in ${d.filePath} [${d.severity}] [id: ${d.id}]`)
        }
      }
      if (imp.upstream.length > 0) {
        lines.push('  Upstream (this depends on):')
        for (const u of imp.upstream) {
          lines.push(`    - ${u.name} (${u.kind}) in ${u.filePath} [${u.severity}] [id: ${u.id}]`)
        }
      }
    }

    if (explored.changeDetection && (explored.changeDetection.filesChanged > 0 || explored.changeDetection.changedSymbols.length > 0)) {
      const cd = explored.changeDetection
      lines.push(`**Detected changes** (${cd.filesChanged} files changed):`)
      for (const s of cd.changedSymbols) {
        lines.push(`  - ${s.name} (${s.kind}) in ${s.filePath} [id: ${s.id}]`)
      }
    }

    if (explored.routeMap && explored.routeMap.routeCount > 0) {
      const rm = explored.routeMap
      lines.push(`**Route map** (${rm.routeCount} routes, ${rm.apiCallCount} API calls):`)
      for (const r of rm.routes) {
        lines.push(`  - ${r.name} in ${r.filePath} [id: ${r.id}]`)
      }
    }

    if (explored.processes && explored.processes.length > 0) {
      lines.push('**Detected processes:**')
      for (const p of explored.processes) {
        lines.push(`  - ${p.method} ${p.path} — ${p.name} [id: ${p.id}]`)
      }
    }

    if (lines.length > 0) {
      sections.push({ priority: 3, text: lines.join('\n') })
    }
  }

  // Assemble within token budget — truncate lowest-priority sections first
  const result: string[] = []
  let usedTokens = 0
  // Sort: include all priority 1, then priority 2, then priority 3
  // Within budget, progressively truncate lower-priority sections
  for (let pri = 1; pri <= 3; pri++) {
    const priSections = sections.filter(s => s.priority === pri)
    for (const section of priSections) {
      const sectionTokens = estimateTokens(section.text)
      if (usedTokens + sectionTokens <= maxTokens) {
        result.push(section.text)
        usedTokens += sectionTokens
      } else if (pri === 3) {
        // For lowest-priority (explored), include as much as fits by truncating lines
        const remaining = maxTokens - usedTokens
        if (remaining > 50) {
          const lines = section.text.split('\n')
          const kept: string[] = []
          let lineTokens = 0
          for (const line of lines) {
            const t = estimateTokens(line)
            if (lineTokens + t > remaining) break
            kept.push(line)
            lineTokens += t
          }
          if (kept.length > 0) {
            result.push(kept.join('\n'))
            usedTokens += lineTokens
          }
        }
      }
      // Priority 1 and 2 sections are always included in full
    }
  }

  return result.join('\n\n')
}

// ── Tool definitions ───────────────────────────────────────────────────────

function defineAgentTools(qs: AuraQueryService, projectPath: string, managedShells?: ManagedShellService, projectId?: string, webSearch?: WebSearchService): AgentTool[] {
  return [
    // ── Graph & Indexing Tools ────────────────────────────────────────────

    {
      name: 'search',
      description: 'Search for symbols by name in the codebase. Returns matching nodes with their ID, name, kind, filePath, and relevance score. Use this first when you need to find a symbol by name. Supports fuzzy matching. Use the "kinds" parameter to filter by symbol type (Function, Class, Interface, Method, Variable, Route, ApiCall). Use "mode" to control search strategy: "hybrid" (default, best quality combining text and semantic), "bm25" (text-only), or "basic" (substring match).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term — symbol name or partial name' },
          limit: { type: 'number', description: 'Maximum results to return', default: 20 },
          kinds: { type: 'array', items: { type: 'string' }, description: 'Filter by node kinds: Function, Class, Interface, Method, Variable, Route, ApiCall' },
          mode: { type: 'string', description: 'Search mode: hybrid (default), bm25, or basic', enum: ['hybrid', 'bm25', 'basic'] },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const results = await qs.search(args.query as string, {
          limit: args.limit as number | undefined,
          kinds: args.kinds as string[] | undefined,
          mode: args.mode as 'hybrid' | 'bm25' | 'basic' | undefined,
        })
        return { results: results.map(r => ({ node: r.node, score: r.score })) }
      },
    },

    {
      name: 'context',
      description: 'Get a 360-degree view of a symbol. Returns the node itself, incoming references (who calls/imports it), outgoing references (what it calls/imports), members (for classes/interfaces), containment info (which file/class contains it), and hierarchy (extends/implements relationships). Use this after search to understand a symbol\'s role and relationships.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Full node ID, e.g. "src/auth.ts:login"' },
        },
        required: ['nodeId'],
      },
      execute: async (args) => {
        const result = qs.context(args.nodeId as string)
        if (!result) return { error: `Node "${args.nodeId}" not found` }
        return result
      },
    },

    {
      name: 'impact',
      description: 'Analyze the blast radius of changing a symbol. Returns downstream impact (who depends on this symbol and will break) and upstream impact (what this symbol depends on). Each affected file has severity: critical (score >= 0.8), moderate (>= 0.5), or low (< 0.5). Use this before making changes to understand the risk.',
      parameters: {
        type: 'object',
        properties: {
          targetId: { type: 'string', description: 'Node ID of the target symbol' },
        },
        required: ['targetId'],
      },
      execute: async (args) => {
        const result = qs.impact(args.targetId as string)
        if (!result) return { error: `Node "${args.targetId}" not found` }
        return result
      },
    },

    {
      name: 'dependents',
      description: 'Find all symbols that depend on the target symbol (who references it). Traverses reverse adjacency (IMPORTS, CALLS, EXTENDS, IMPLEMENTS, DEPENDS_ON edges). Returns nodes ordered by proximity. Use this to understand what code depends on a symbol.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Node ID to find dependents for' },
          depth: { type: 'number', description: 'Maximum traversal depth (default: unlimited)' },
        },
        required: ['nodeId'],
      },
      execute: async (args) => {
        return qs.dependents(args.nodeId as string, args.depth as number | undefined)
      },
    },

    {
      name: 'dependencies',
      description: 'Find all symbols the target symbol depends on (what it references). Traverses forward adjacency (IMPORTS, CALLS, EXTENDS, IMPLEMENTS, DEPENDS_ON edges). Returns nodes ordered by proximity. Use this to understand what a symbol relies on.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Node ID to find dependencies for' },
          depth: { type: 'number', description: 'Maximum traversal depth (default: unlimited)' },
        },
        required: ['nodeId'],
      },
      execute: async (args) => {
        return qs.dependencies(args.nodeId as string, args.depth as number | undefined)
      },
    },

    // ── API & Process Tools ───────────────────────────────────────────────

    {
      name: 'route_map',
      description: 'Get all HTTP route registrations in the project. Returns Route nodes, ApiCall nodes, and HANDLES/FETCHES/MIDDLEWARE edges. Use this to understand the API surface — what endpoints exist, what handlers serve them, and what external APIs they call.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return qs.routeMap()
      },
    },

    {
      name: 'tool_map',
      description: 'Get all MCP tool definitions in the project. Returns MCP tool Route nodes and their HANDLES edges.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return qs.toolMap()
      },
    },

    {
      name: 'shape_check',
      description: 'Compare a route\'s response shape against how consumers actually access it. Returns mismatches where consumers use fields not present in the response. Use this before modifying API response structures.',
      parameters: {
        type: 'object',
        properties: {
          routeId: { type: 'string', description: 'Route node ID, e.g. "src/routes/users.ts:GET /api/users/:id"' },
        },
        required: ['routeId'],
      },
      execute: async (args) => {
        const result = qs.shapeCheck(args.routeId as string)
        if (!result) return { error: `Route "${args.routeId}" not found` }
        return result
      },
    },

    {
      name: 'api_impact',
      description: 'Comprehensive risk report for an API route. Returns consumers, response shape vs consumer mismatches, middleware, downstream impact, and overall risk level (low/medium/high/critical).',
      parameters: {
        type: 'object',
        properties: {
          routeId: { type: 'string', description: 'Route node ID' },
        },
        required: ['routeId'],
      },
      execute: async (args) => {
        const result = qs.apiImpact(args.routeId as string)
        if (!result) return { error: `Route "${args.routeId}" not found` }
        return result
      },
    },

    {
      name: 'processes',
      description: 'List all detected execution flows (process traces) in the project. Each process represents an HTTP request lifecycle from route entry through middleware, handler, and service calls.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return qs.getProcesses()
      },
    },

    {
      name: 'process_detail',
      description: 'Get detailed steps of a specific execution flow (process trace). Returns ordered steps with node IDs, names, kinds, and step labels (entry/middleware/handler/service/call).',
      parameters: {
        type: 'object',
        properties: {
          processId: { type: 'string', description: 'Process node ID from the processes list' },
        },
        required: ['processId'],
      },
      execute: async (args) => {
        const result = qs.getProcessDetail(args.processId as string)
        if (!result) return { error: `Process "${args.processId}" not found` }
        return result
      },
    },

    // ── Context & Exploration Tools ───────────────────────────────────────

    {
      name: 'context_manifest',
      description: 'Get the AI-generated context manifest for the project. Lists all folders that have been analyzed with their architectural roles, key exports, and dependencies. Use this to get a high-level overview of the project structure.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const manifest = qs.getContextManifest()
        if (!manifest) return { error: 'Context manifest not available. Index the project first.' }
        return manifest
      },
    },

    {
      name: 'context_folder',
      description: 'Get AI-generated context for a specific folder. Returns a markdown document describing the folder\'s architectural role, key exports, dependencies, and types.',
      parameters: {
        type: 'object',
        properties: {
          folderPath: { type: 'string', description: 'Folder path relative to project root, e.g. "server/services" or "src/components"' },
        },
        required: ['folderPath'],
      },
      execute: async (args) => {
        const content = qs.getContextForFolder(args.folderPath as string)
        if (!content) return { error: `Context for folder "${args.folderPath}" not found` }
        return { folder: args.folderPath, content }
      },
    },

    {
      name: 'get_graph',
      description: 'Get the full dependency graph (all nodes and edges). WARNING: This can be very large for big projects. Prefer using search, context, or impact for targeted queries. Use this only when you need the full picture.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const graph = qs.getGraph()
        if (graph.nodes.length > 500) {
          return {
            nodes: graph.nodes.length,
            edges: graph.edges.length,
            nodeKinds: [...new Set(graph.nodes.map(n => n.kind))],
            edgeTypes: [...new Set(graph.edges.map(e => e.type))],
            hint: 'Graph is large. Use search, context, or impact for targeted queries.',
          }
        }
        return graph
      },
    },

    // ── Change Analysis Tools ─────────────────────────────────────────────

    {
      name: 'detect_changes',
      description: 'Analyze git diff to find changed symbols and their blast radius. Returns changed files, changed symbols with line ranges, and merged impact analysis. Requires the project to be a git repository.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Git diff scope: "unstaged" (default), "staged", "all", or "compare"', enum: ['unstaged', 'staged', 'all', 'compare'] },
          base: { type: 'string', description: 'Base commit for "compare" scope' },
          head: { type: 'string', description: 'Head commit for "compare" scope' },
        },
      },
      execute: async () => {
        return { note: 'detect_changes requires project path context. Use the project path from the agent context.' }
      },
    },

    {
      name: 'rename',
      description: 'Find all references to a symbol across the codebase and return a preview of the edits needed to rename it. Uses graph traversal (high confidence) and text search (lower confidence). Returns edits with file paths, old/new text, and confidence levels — does NOT apply changes. Use the update tool to apply the edits you want.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Node ID of the symbol to rename. If just a name, will search for it.' },
          newName: { type: 'string', description: 'New name for the symbol' },
        },
        required: ['nodeId', 'newName'],
      },
      execute: async (args) => {
        let resolvedId = args.nodeId as string
        const newName = args.newName as string
        if (!resolvedId.includes(':')) {
          const results = await qs.search(resolvedId, { limit: 10, mode: 'basic' })
          if (results.length === 0) return { error: `Symbol "${resolvedId}" not found` }
          if (results.length > 1) {
            return {
              error: `Symbol "${resolvedId}" is ambiguous. Please provide a full nodeId.`,
              candidates: results.map(r => ({ id: r.node.id, name: r.node.name, filePath: r.node.filePath })),
            }
          }
          resolvedId = results[0].node.id
        }
        return await qs.rename(resolvedId, newName, true)
      },
    },

    // ── File Operation Tools ──────────────────────────────────────────────

    {
      name: 'read_file',
      description: 'Read the contents of a source file with line numbers. IMPORTANT: Always provide explicit startLine and endLine when you know the range you need — e.g., "read file.ts from line 10 to 50". If you omit startLine/endLine, the file will be truncated at 1000 lines and you will need another call to read the rest. For targeted lookups, prefer search_pattern instead — it gives you matches with surrounding context without reading entire files.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'File path relative to project root, e.g. "src/auth.ts" or "server/services/graph.ts"' },
          startLine: { type: 'number', description: 'Line number to start reading from (1-based). Providing this avoids truncation.' },
          endLine: { type: 'number', description: 'Line number to stop reading at (inclusive). Providing this avoids truncation.' },
        },
        required: ['filePath'],
      },
      execute: async (args) => {
        const filePath = args.filePath as string
        const startLine = args.startLine as number | undefined
        const endLine = args.endLine as number | undefined
        const explicitRange = startLine !== undefined || endLine !== undefined
        const fullPath = path.resolve(projectPath, filePath)

        if (!fullPath.startsWith(path.resolve(projectPath))) {
          return { error: 'Invalid file path' }
        }

        try {
          const content = await fs.readFile(fullPath, 'utf-8')
          const lines = content.split('\n')
          const start = Math.max(1, startLine ?? 1)
          const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length

          if (start > lines.length) {
            return { error: `File has ${lines.length} lines. startLine ${start} is out of range.` }
          }

          const MAX_LINES = 1000
          let actualEnd = end
          let truncated = false

          if (!explicitRange && lines.length > MAX_LINES) {
            actualEnd = start + MAX_LINES - 1
            truncated = true
          } else {
            actualEnd = end
          }

          const selected = lines.slice(start - 1, actualEnd)
          const numbered = selected.map((line, i) => `${start + i}: ${line}`).join('\n')

          return {
            filePath,
            totalLines: lines.length,
            startLine: start,
            endLine: actualEnd,
            ...(truncated ? { note: `File truncated at ${MAX_LINES} lines because no explicit line range was given. The file has ${lines.length} lines total. Call read_file again with startLine/endLine to read the remaining lines (e.g., startLine: ${actualEnd + 1}, endLine: ${lines.length}).` } : {}),
            content: numbered,
          }
        } catch (err) {
          return { error: `Could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    },

    {
      name: 'search_pattern',
      description: 'Search for a pattern (regex or plain text) across files in the project. Returns each match with surrounding context lines — like grep -C. Use this to find where a function is defined, how a variable is used, or where an error message appears. Much faster than reading entire files when you only need specific areas.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern — a regex or plain text string. E.g. "function handleSubmit" or "class AuthMiddleware"' },
          glob: { type: 'string', description: 'File glob to filter which files to search, e.g. "*.ts", "src/**/*.tsx", "server/**/*.ts". Omit to search all files.' },
          contextLines: { type: 'number', description: 'Number of context lines before and after each match (default: 5, max: 20)' },
          maxMatches: { type: 'number', description: 'Maximum number of matches to return (default: 30). Increase for broad searches.' },
        },
        required: ['pattern'],
      },
      execute: async (args) => {
        const pattern = args.pattern as string
        const glob = args.glob as string | undefined
        const contextLines = Math.min(20, (args.contextLines as number) ?? 5)
        const maxMatches = (args.maxMatches as number) ?? 30

        try {
          const regex = new RegExp(pattern, 'i')
          const results: Array<{ filePath: string; line: number; column: number; match: string; before: string[]; after: string[] }> = []

          const searchDir = async (dir: string, relPath: string) => {
            if (results.length >= maxMatches) return
            const entries = await fs.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (results.length >= maxMatches) break
              const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name
              if (entry.isDirectory() && ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache'].includes(entry.name)) continue
              const entryFullPath = path.join(dir, entry.name)
              if (entry.isDirectory()) {
                await searchDir(entryFullPath, entryRelPath)
              } else {
                if (glob) {
                  const ext = entry.name.includes('.') ? '*.' + entry.name.split('.').pop() : entry.name
                  const fileGlob = `**/${ext}`
                  if (!matchesGlob(entryRelPath, glob) && !matchesGlob(entry.name, glob)) continue
                }
                if (/\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp3|mp4|zip|tar|gz|wasm|lock)$/i.test(entry.name)) continue
                try {
                  const content = await fs.readFile(entryFullPath, 'utf-8')
                  const lines = content.split('\n')
                  for (let i = 0; i < lines.length; i++) {
                    if (results.length >= maxMatches) break
                    const match = regex.exec(lines[i])
                    regex.lastIndex = 0
                    if (match) {
                      const before = lines.slice(Math.max(0, i - contextLines), i)
                      const after = lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines))
                      results.push({
                        filePath: entryRelPath,
                        line: i + 1,
                        column: match.index + 1,
                        match: match[0],
                        before,
                        after,
                      })
                    }
                  }
                } catch {
                  // Skip unreadable files
                }
              }
            }
          }

          await searchDir(projectPath, '')
          return { pattern, totalMatches: results.length, matches: results }
        } catch (err) {
          return { error: `Invalid pattern "${pattern}": ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    },

    {
      name: 'write',
      description: 'Write content to a file. Creates the file and any parent directories if they don\'t exist. Overwrites the entire file if it already exists. Use this to create new files or completely replace a file\'s contents. For making targeted edits to existing files, prefer the update tool instead — it\'s safer and preserves the rest of the file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'File path relative to project root, e.g. "src/utils/helpers.ts"' },
          content: { type: 'string', description: 'The full content to write to the file' },
        },
        required: ['filePath', 'content'],
      },
      execute: async (args) => {
        const filePath = args.filePath as string
        const content = args.content as string
        const fullPath = path.resolve(projectPath, filePath)

        if (!fullPath.startsWith(path.resolve(projectPath))) {
          return { error: 'Invalid file path — path escapes the project directory' }
        }

        try {
          let previousContent: string | null = null
          const exists = await fs.access(fullPath).then(() => true).catch(() => false)
          if (exists) {
            previousContent = await fs.readFile(fullPath, 'utf-8')
          }
          await fs.mkdir(path.dirname(fullPath), { recursive: true })
          await fs.writeFile(fullPath, content, 'utf-8')

          const linesWritten = content.split('\n').length
          return {
            filePath,
            linesWritten,
            created: !exists,
            applied: true,
            previousContent,
          }
        } catch (err) {
          return { error: `Could not write file "${filePath}": ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    },

    {
      name: 'update',
      description: 'Make a targeted edit to an existing file by replacing a specific string with new text. The oldString must exactly match the text in the file (including whitespace and indentation). If oldString appears multiple times, either provide more surrounding context to make it unique, or set replaceAll to true. Always read_file first to see the exact text before editing. Prefer this over write for making changes to existing files — it\'s safer and preserves the rest of the file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'File path relative to project root, e.g. "src/auth.ts"' },
          oldString: { type: 'string', description: 'The exact text to find in the file. Must match exactly including whitespace and indentation.' },
          newString: { type: 'string', description: 'The text to replace oldString with' },
          replaceAll: { type: 'boolean', description: 'If true, replace all occurrences of oldString instead of just the first. Default: false.', default: false },
        },
        required: ['filePath', 'oldString', 'newString'],
      },
      execute: async (args) => {
        const filePath = args.filePath as string
        const oldString = args.oldString as string
        const newString = args.newString as string
        const replaceAll = args.replaceAll as boolean | undefined
        const fullPath = path.resolve(projectPath, filePath)

        if (!fullPath.startsWith(path.resolve(projectPath))) {
          return { error: 'Invalid file path — path escapes the project directory' }
        }

        try {
          const content = await fs.readFile(fullPath, 'utf-8')

          // Normalize line endings: the AI may send \n but the file may have \r\n.
          // Compare on normalized (\n) versions but write back with the file's original line endings.
          const fileEol = content.includes('\r\n') ? '\r\n' : '\n'
          const normalizeEol = (s: string) => s.replace(/\r\n/g, '\n')
          const normalizedContent = normalizeEol(content)
          const normalizedOldString = normalizeEol(oldString)
          const normalizedNewString = normalizeEol(newString)

          if (!normalizedContent.includes(normalizedOldString)) {
            return {
              error: `oldString not found in "${filePath}". Use read_file to see the exact content and try again.`,
              hint: 'Make sure the string matches exactly, including whitespace, indentation, and line breaks.',
            }
          }

          if (!replaceAll) {
            const firstIndex = normalizedContent.indexOf(normalizedOldString)
            const secondIndex = normalizedContent.indexOf(normalizedOldString, firstIndex + 1)
            if (secondIndex !== -1) {
              return {
                error: `oldString appears ${normalizedContent.split(normalizedOldString).length - 1} times in "${filePath}". Provide more surrounding context to make it unique, or set replaceAll to true.`,
              }
            }
          }

          const normalizedNewContent = replaceAll
            ? normalizedContent.replaceAll(normalizedOldString, normalizedNewString)
            : normalizedContent.replace(normalizedOldString, normalizedNewString)

          // Write back with the file's original line endings
          const newContent = fileEol === '\r\n' ? normalizedNewContent.replace(/\n/g, '\r\n') : normalizedNewContent

          const replacements = replaceAll
            ? normalizedContent.split(normalizedOldString).length - 1
            : 1

          await fs.writeFile(fullPath, newContent, 'utf-8')

          return {
            filePath,
            replacements,
            applied: true,
            previousContent: content,
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return { error: `File "${filePath}" does not exist. Use the write tool to create new files.` }
          }
          return { error: `Could not update file "${filePath}": ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    },

    // ── Command Execution Tools ────────────────────────────────────────────

    {
      name: 'execute',
      description: 'Run a shell command in the project directory. You are already in the project root — do NOT prefix commands with `cd`. Just run the command directly (e.g. `npm run build`, not `cd /path && npm run build`). Use this to test fixes, install packages, or verify changes. Do NOT use this for git operations — use the `git` tool instead. Returns stdout, stderr, and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run, e.g. "npm run build", "npx tsc --noEmit", "npm test". Do NOT use for git commands — use the `git` tool instead.' },
          timeout: { type: 'number', description: 'Timeout in seconds (default: 30, max: 120)' },
        },
        required: ['command'],
      },
      execute: async (args) => {
        const command = args.command as string
        const timeoutSeconds = Math.min(120, (args.timeout as number | undefined) ?? 30)
        const timeoutMs = timeoutSeconds * 1000

        // Route git commands to the dedicated git tool (including chained commands)
        if (/^git\s/i.test(command.trim()) || /(?:&&|;|\|)\s*git\s/i.test(command)) {
          return { error: `Git commands must use the dedicated "git" tool, not "execute". Use the git tool for all version control operations.` }
        }

        // NOTE: Dangerous commands (DANGEROUS_COMMAND_DESCRIPTIONS) are checked in the agent loop
        // (after tool_call is emitted but before execution), not here, because we need
        // access to the ApprovalManager and eventSink which aren't available in tool execute.

        // NOTE: Commands matching DANGEROUS_COMMAND_DESCRIPTIONS are checked in the agent loop
        // (after tool_call is emitted but before execution), not here, because we need
        // access to the ApprovalManager and eventSink which aren't available in tool execute.

        try {
          const { stdout, stderr } = await execFileAsync(command, [], {
            cwd: projectPath,
            shell: true,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
          })

          let out = (stdout || '').trim()
          let err = (stderr || '').trim()

          return {
            exitCode: 0,
            stdout: out,
            stderr: err,
          }
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string; code?: string; killed?: boolean; signal?: string }
          if (execErr.killed) {
            return { exitCode: -1, stdout: (execErr.stdout || '').trim(), stderr: `Command timed out after ${timeoutSeconds}s`, timedOut: true }
          }
          return {
            exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
            stdout: (execErr.stdout || '').trim(),
            stderr: (execErr.stderr || '').trim() || (err instanceof Error ? err.message : String(err)),
          }
        }
      },
    },

    // ── Version Control Tool ──────────────────────────────────────────────────

    {
      name: 'git',
      description: 'Execute git commands for version control. Use this for ALL git operations — staging changes, committing, branching, merging, checking status, viewing logs, etc. You are already in the project root so do not prefix with `cd`. After verifying each todo\'s changes (running build/test commands via `execute`), you MUST commit: `git add -A` then `git commit -m "type: description"`. Commit messages use conventional format: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.',
      parameters: {
        type: 'object',
        properties: {
          args: { type: 'string', description: 'Git subcommand and arguments, e.g. "add -A", "commit -m feat: add auth", "checkout -b aura/add-auth", "status", "log --oneline -5", "diff", "branch"' },
        },
        required: ['args'],
      },
      execute: async (args) => {
        const gitArgs = (args.args as string).trim()
        const subcommand = gitArgs.split(/\s+/)[0]

        const validSubcommands = ['add', 'branch', 'checkout', 'commit', 'diff', 'fetch', 'init', 'log', 'merge', 'pull', 'push', 'rebase', 'remote', 'reset', 'restore', 'revert', 'show', 'stash', 'status', 'switch', 'tag', 'worktree', 'reflog', 'blame', 'grep', 'ls-files', 'config']
        if (!validSubcommands.includes(subcommand)) {
          return { error: `Unknown git subcommand: "${subcommand}". Valid subcommands: ${validSubcommands.join(', ')}` }
        }

        // Validate chained subcommands (e.g. "add -A && git commit -m ...")
        const chainedParts = gitArgs.split(/\s*&&(?:\s*git\s+|\s+)/).filter(Boolean)
        for (const part of chainedParts) {
          const chainSubcmd = part.trim().split(/\s+/)[0]
          if (chainSubcmd && !validSubcommands.includes(chainSubcmd)) {
            return { error: `Unknown git subcommand in chain: "${chainSubcmd}". Valid subcommands: ${validSubcommands.join(', ')}` }
          }
        }

        // NOTE: Dangerous git commands (force push, reset --hard, etc.) are checked in the agent loop
        // via DANGEROUS_COMMAND_DESCRIPTIONS — they route to the approval system instead of being hard-blocked.

        const fullCommand = `git ${gitArgs}`
        try {
          const { stdout, stderr } = await execFileAsync(fullCommand, [], {
            cwd: projectPath,
            shell: true,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          })

          return {
            exitCode: 0,
            stdout: (stdout || '').trim(),
            stderr: (stderr || '').trim(),
          }
        } catch (err) {
          const execErr = err as { stdout?: string; stderr?: string; code?: string; killed?: boolean; signal?: string }
          if (execErr.killed) {
            return { exitCode: -1, stdout: (execErr.stdout || '').trim(), stderr: 'Command timed out after 30s', timedOut: true }
          }
          return {
            exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
            stdout: (execErr.stdout || '').trim(),
            stderr: (execErr.stderr || '').trim() || (err instanceof Error ? err.message : String(err)),
          }
        }
      },
    },

    // ── Managed Shell Tools ──────────────────────────────────────────────────

    {
      name: 'shell_spawn',
      description: 'Spawn a background shell for long-running commands (dev servers, builds, test suites, watchers). The shell runs independently — check on it with shell_read. Before spawning, use shell_list to check for duplicate commands and terminate any existing shell running the same command. Do NOT use for quick commands — use execute for those.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Descriptive name for this shell, e.g. "dev-server", "build-project", "install-deps"' },
          command: { type: 'string', description: 'The shell command to run in the background' },
          cwd: { type: 'string', description: 'Working directory (defaults to project root)' },
        },
        required: ['name', 'command'],
      },
      execute: async (args) => {
        if (!managedShells || !projectId) {
          return { error: 'Managed shells are not available for this project' }
        }
        try {
          const shell = await managedShells.spawn(projectId, args.name as string, args.command as string, args.cwd as string | undefined)
          return { shellId: shell.id, name: shell.name, status: shell.status, message: `Background shell "${shell.name}" spawned. Use shell_read to check progress.` }
        } catch (err: unknown) {
          return { error: `Failed to spawn shell: ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    },
    {
      name: 'shell_read',
      description: 'Read the output and status of a background shell. Returns recent output (last 1MB, ANSI-stripped for readability), status (running/completed/failed/killed), and exit code. Always use this to confirm a shell finished successfully before starting dependent work.',
      parameters: {
        type: 'object',
        properties: {
          shellId: { type: 'string', description: 'The shell ID returned by shell_spawn' },
          tailLines: { type: 'number', description: 'Number of lines to return from the end of output (default: all)' },
        },
        required: ['shellId'],
      },
      execute: async (args) => {
        if (!managedShells) {
          return { error: 'Managed shells are not available' }
        }
        const result = managedShells.readOutput(args.shellId as string, args.tailLines as number | undefined, true)
        if (!result) {
          return { error: `Shell "${args.shellId}" not found. Use shell_list to see available shells.` }
        }
        return result
      },
    },
    {
      name: 'shell_terminate',
      description: 'Terminate a running background shell. After terminating, verify the process is actually dead using the process/port checks described in the "Verifying Server Status" section — do not assume success just because this tool returned it.',
      parameters: {
        type: 'object',
        properties: {
          shellId: { type: 'string', description: 'The shell ID to terminate' },
        },
        required: ['shellId'],
      },
      execute: async (args) => {
        if (!managedShells) {
          return { error: 'Managed shells are not available' }
        }
        const success = managedShells.terminate(args.shellId as string)
        return success
          ? { success: true, message: `Shell "${args.shellId}" terminated` }
          : { error: `Shell "${args.shellId}" not found or already exited` }
      },
    },
    {
      name: 'shell_list',
      description: 'List all background shells with their ID, name, command, status, and exit code. Use this before shell_spawn to check for duplicate commands, and before shell_terminate to find the right shell ID.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        if (!managedShells) {
          return { error: 'Managed shells are not available' }
        }
        const shells = managedShells.listShells(projectId)
        return { shells }
      },
    },

    // ── Web Research Tools ─────────────────────────────────────────────────

    {
      name: 'search_web',
      description: 'Search the web or fetch web page content. Use "query" to search for pages about a topic — returns titles, URLs, and snippets. Use "url" to fetch the full content of a specific page. Use "design: true" with a URL to extract visual design tokens (CSS variables, colors, fonts, spacing). Use "flags" for advanced crawl options — when flags are provided, the full rendering engine is used instead of the fast path.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'A URL to fetch and render directly. ALWAYS prefer this when a URL is available. (e.g. "https://react.dev/blog")' },
          query: { type: 'string', description: 'A search query to find pages about a topic. Use ONLY when you don\'t have a URL. (e.g. "React 19 release notes")' },
          design: {
            type: 'boolean',
            description: 'Extract design tokens (CSS variables, colors, fonts, spacing, border radii, shadows) from the page. REQUIRES a URL. Use when the user asks about a website\'s visual design, theme, or styling.',
          },
          flags: {
            type: 'object',
            description: 'Optional crawl4ai flags for advanced crawling.',
            properties: {
              deep_crawl: { type: 'string', enum: ['bfs', 'dfs', 'best-first'], description: 'Follow links across multiple pages.' },
              max_pages: { type: 'integer', description: 'Max pages to visit during a deep crawl (default 10).' },
              enable_stealth: { type: 'boolean', description: 'Bypass anti-bot detection.' },
              user_agent_mode: { type: 'string', enum: ['default', 'random', 'mobile'], description: 'User agent strategy.' },
              avoid_ads: { type: 'boolean', description: 'Block ad and tracker requests.' },
              css_selector: { type: 'string', description: 'CSS selector to extract only a specific part of the page.' },
              wait_until: { type: 'string', enum: ['domcontentloaded', 'networkidle', 'load'], description: 'Page load condition.' },
              delay_before_return_html: { type: 'number', description: 'Seconds to wait after page load (default 0.1).' },
              scan_full_page: { type: 'boolean', description: 'Scroll through the entire page before extracting.' },
              remove_overlay_elements: { type: 'boolean', description: 'Remove popup/modal overlays and cookie banners.' },
              magic: { type: 'boolean', description: 'Auto-handle popups, consent banners, and overlays.' },
              simulate_user: { type: 'boolean', description: 'Simulate human mouse movements and interactions.' },
              process_iframes: { type: 'boolean', description: 'Extract content from iframes.' },
              exclude_external_links: { type: 'boolean', description: 'Remove external links from output.' },
              exclude_social_media_links: { type: 'boolean', description: 'Remove social media links from output.' },
              word_count_threshold: { type: 'integer', description: 'Minimum word count for content blocks (default 200).' },
            },
          },
        },
      },
      execute: async (args) => {
        if (!webSearch) {
          return { error: 'Web search is not available.' }
        }
        return webSearch.search({
          query: args.query,
          url: args.url,
          design: args.design,
          flags: args.flags,
        })
      },
    },

    // ── Agent Orchestration ────────────────────────────────────────────────

    {
      name: 'todo_write',
      description: 'Manage the task list for the current build. Use this to create, update, and track progress on implementation steps. Always create a todo list before starting a build task. Mark items in_progress when you begin work, and completed when done. Each call sends the FULL list — include all items, not just changed ones.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique ID for this todo item, e.g. "1"' },
                subject: { type: 'string', description: 'Brief imperative title, e.g., "Create auth module"' },
                description: { type: 'string', description: 'Detailed description of what to do' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Current status' },
                blockedBy: { type: 'array', items: { type: 'string' }, description: 'IDs of todos this depends on' },
              },
              required: ['id', 'subject', 'description', 'status'],
            },
            description: 'The full list of todos. Each call replaces the entire list — include ALL items, not just changed ones.',
          },
        },
        required: ['todos'],
      },
      execute: async () => {
        return { acknowledged: true }
      },
    },

    {
      name: 'dispatch_sub_agents',
      description: 'Spawn sub-agents for token-heavy tasks like exploration, research, or planning — this offloads work from your context window so it does not get bloated with intermediate tool results. Each sub-agent runs its own tool-calling loop and returns a concise summary. Write DETAILED task descriptions — sub-agents start with no conversation context, so include all relevant details, file paths, and specific questions in the task field. Use preContext to forward facts you have already discovered so the sub-agent does not re-discover them. Choose the right type: "explore" for investigating code, "research" for web/docs, "plan" for creating implementation plans.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short title for this task, e.g. "Explore auth module" or "Trace API dependencies"' },
                task: { type: 'string', description: 'A detailed, specific prompt for the sub-agent. Include file paths, symbol names, error messages, and exactly what to find or produce. The sub-agent has no conversation context — everything it needs to know must be in this field or preContext. Vague prompts waste iterations.' },
                focus: { type: 'string', description: 'Specific focus area — e.g., "upstream dependencies", "API surface", "auth module"' },
                type: { type: 'string', enum: ['explore', 'research', 'plan'], description: 'Agent type: "explore" (investigate code, read-only), "research" (web/docs), "plan" (create implementation plan, read-only)' },
                preContext: { type: 'string', description: 'Optional context to give the sub-agent a head start — relevant findings, file paths, or facts the main agent has already discovered. Use this when you have information that would save the sub-agent from re-discovering it. Only include what is directly relevant to the task.' },
              },
              required: ['title', 'task'],
            },
            description: 'Tasks for sub-agents to work on',
          },
        },
        required: ['tasks'],
      },
      execute: async () => {
        return { error: 'dispatch_sub_agents should not be called directly' }
      },
    },

    {
      name: 'visual_preview',
      description: 'Write an HTML content fragment to the visual companion and show it to the user in a Visual tab. Use for UI mockups, wireframes, architecture diagrams, layout comparisons, flow diagrams, and any visual content that is clearer shown than described in text. After calling this tool, do NOT describe the visual content in text — the user can see it in the Visual tab. Just tell them the preview is ready and what to look for, then call `read_visual_events` to collect their selections. The server wraps your fragment in a styled frame with interactive options, selection tracking, and live reload. Available CSS classes: .options/.option for A/B/C choices (with data-choice attributes and onclick="toggleSelect(this)"), .cards/.card for visual designs, .mockup/.mockup-header/.mockup-body for previews, .split for side-by-side, .pros-cons for comparisons, .mock-nav/.mock-sidebar/.mock-content/.mock-button/.mock-input/.placeholder for wireframe elements, .subtitle/.section/.label for typography, h2/h3 for headings. Write content fragments by default (no <html>/<head>/<body> tags).',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Semantic filename for this screen, e.g. "dashboard-layout" or "auth-flow-diagram". Never reuse filenames — append version suffixes like "-v2" for iterations. Only alphanumeric, hyphens, and underscores.' },
          content: { type: 'string', description: 'HTML content fragment using the provided CSS classes. NOT a full HTML document — the frame provides <html>, <head>, <body>, and all styling. Use .options/.option for choices, .cards/.card for visual designs, .mockup for previews, etc.' },
          title: { type: 'string', description: 'Brief title shown to the user, e.g. "Dashboard Layout Options" or "Auth Flow Diagram"' },
        },
        required: ['filename', 'content', 'title'],
      },
      execute: async () => ({ acknowledged: true }),
    },

    {
      name: 'read_visual_events',
      description: 'Read user click/selection interactions from the visual companion. ALWAYS call this after `visual_preview` — the user makes selections in the Visual tab and this tool retrieves them. Call pattern: (1) push screen with `visual_preview`, (2) wait for user to interact, (3) call `read_visual_events` to get their choices. Events are cleared after reading, so each call returns only new interactions since the last read.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => ({ acknowledged: true }),
    },

    {
      name: 'close_visual',
      description: 'Close the visual companion tab when the visual preview is no longer needed — typically after all visual decisions have been made or when the task is complete. This removes the Visual tab from the UI.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => ({ acknowledged: true }),
    },

    {
      name: 'ask_user',
      description: 'Ask the user a clarifying question with predefined options. Use this when you need to make a decision that affects the implementation and the answer isn\'t clear from the context. Provide a clear question and 2-4 options.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '2-4 predefined options for the user to choose from',
          },
        },
        required: ['question', 'options'],
      },
      execute: async () => ({ acknowledged: true }),
    },

    {
      name: 'load_skill',
      description: 'Load a skill guide that provides domain-specific strategy and tool usage instructions. Call this when you realize the task would benefit from specialized guidance — for example, when you discover the task involves building, debugging, refactoring, impact analysis, exploration, or visual design. Each skill provides targeted instructions for how to approach that type of task effectively. Available skills: aura-building (scaffolding, feature implementation, build workflow), aura-exploring (codebase navigation, investigation strategy), aura-impact (change impact analysis, risk assessment), aura-debugging (bug tracing, error investigation), aura-refactoring (safe renaming, extraction, restructuring), aura-visual (mockups, diagrams, visual companion usage).',
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            enum: ['aura-building', 'aura-exploring', 'aura-impact', 'aura-debugging', 'aura-refactoring', 'aura-visual'],
            description: 'The skill to load',
          },
        },
        required: ['skill'],
      },
      execute: async (args) => {
        const skillName = (args as { skill?: string }).skill || ''
        const validSkills = ['aura-building', 'aura-exploring', 'aura-impact', 'aura-debugging', 'aura-refactoring', 'aura-visual']
        if (!validSkills.includes(skillName)) {
          return { error: `Unknown skill "${skillName}". Valid skills: ${validSkills.join(', ')}` }
        }
        try {
          const skillPath = path.resolve(process.cwd(), 'server', 'skills', skillName, 'SKILL.md')
          const content = await fs.readFile(skillPath, 'utf-8')
          return { skill: skillName, content }
        } catch {
          return { error: `Failed to load skill "${skillName}": file not found` }
        }
      },
    },
  ]
}

function buildOllamaTools(tools: AgentTool[]): OllamaTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }))
}

// ── Agent class ─────────────────────────────────────────────────────────────

export class AuraAgent {
  private qs: AuraQueryService
  private projectPath: string
  private ollamaBaseUrl: string
  private model: string
  private contextWindow: number
  private abortController: AbortController | null = null
  private approvalManager: ApprovalManager
  private managedShells: ManagedShellService | null
  private projectId: string | null
  private chatService: AuraChatService | null
  private chatId: string | null
  private webSearch: WebSearchService

  constructor(qs: AuraQueryService, projectPath: string, ollamaBaseUrl?: string, model?: string, contextWindow?: number, managedShells?: ManagedShellService, projectId?: string, chatService?: AuraChatService, chatId?: string, apiKey?: string) {
    this.qs = qs
    this.projectPath = projectPath
    this.ollamaBaseUrl = ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    this.model = model || process.env.OLLAMA_MODEL || 'glm-5.1:cloud'
    this.contextWindow = contextWindow ?? 200_000
    this.managedShells = managedShells || null
    this.projectId = projectId || null
    this.chatService = chatService || null
    this.chatId = chatId || null
    this.webSearch = new WebSearchService(apiKey)
    // Get or create the ApprovalManager for this project
    let am = globalApprovalManagers.get(projectPath)
    if (!am) {
      am = new ApprovalManager()
      globalApprovalManagers.set(projectPath, am)
    }
    this.approvalManager = am
  }

  static estimateSystemTokens(qs: AuraQueryService, projectPath: string, ollamaBaseUrl: string, model: string): number {
    const systemPrompt = buildSystemPrompt('', undefined, undefined, undefined, undefined, platform() === 'win32')
    return estimateTokens(systemPrompt)
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  async run(prompt: string, eventSink: AgentEventSink, context?: Record<string, unknown>, priorMessages?: Array<{ role: string; content: string; tool_calls?: Array<{ id?: string; function: { name: string; arguments: Record<string, unknown> } }>; tool_call_id?: string; name?: string }>, sourceMessageIds?: string[]): Promise<void> {
    this.abortController = new AbortController()

    // Check Ollama availability
    const available = await this.checkAvailability()
    if (!available) {
      eventSink.emit('error', { message: 'Ollama is not available. Please start Ollama and try again.' })
      eventSink.emit('done', {})
      return
    }

    // Detect intent and load skills
    const skills = detectIntent(prompt)
    const skillContent = await loadSkills(skills)
    const contextSection = context ? formatContext(context) : undefined

    // Detect greenfield (empty project directory)
    let isGreenfield = false
    try {
      const entries = await fs.readdir(this.projectPath)
      const codeFiles = entries.filter(e => !e.startsWith('.') && e !== 'node_modules')
      isGreenfield = codeFiles.length === 0
    } catch { isGreenfield = true }

    // Detect git context
    let gitContext = ''
    let currentBranch = ''
    try {
      const { stdout: branchStdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.projectPath })
      currentBranch = branchStdout.trim()
      gitContext += `Current branch: ${currentBranch}\n`
      const { stdout: statusStdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: this.projectPath })
      if (statusStdout.trim()) {
        gitContext += 'There are uncommitted changes in the working directory. You may want to commit or stash them before making new changes.\n'
      }
    } catch {
      gitContext += 'Git is not available or this is not a git repository. Skip git operations.\n'
    }

    // ── Plan resumption ────────────────────────────────────────────────────────
    const planService = new PlanPersistenceService()
    let planResume: PlanResumeContext | null = null
    let activePlan: SavedPlan | null = null
    let slug = prompt.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    // Try to load an existing active plan (finds by branch, then falls back to ANY plan with pending todos)
    try {
      activePlan = await planService.loadActivePlan(this.projectPath, currentBranch)
    } catch { /* plan resume is best-effort */ }

    if (activePlan) {
      slug = activePlan.slug
      const pendingTodos = activePlan.todos.filter(t => t.status !== 'completed')
      if (pendingTodos.length > 0) {
        planResume = {
          slug: activePlan.slug,
          originalPrompt: activePlan.originalPrompt,
          todos: activePlan.todos,
          nextTask: pendingTodos[0].subject,
        }
        if (currentBranch === 'main' || currentBranch === 'master') {
          gitContext += `Active plan "${activePlan.slug}" is on branch ${activePlan.branchName}. Use \`git checkout ${activePlan.branchName}\` to resume.\n`
        }
      } else {
        await planService.deletePlan(this.projectPath, activePlan.slug)
        activePlan = null
      }
    }

    const isWindows = platform() === 'win32'
    const systemPrompt = buildSystemPrompt(skillContent, contextSection, isGreenfield || undefined, gitContext || undefined, planResume || undefined, isWindows)

    // Build tools
    const tools = defineAgentTools(this.qs, this.projectPath, this.managedShells ?? undefined, this.projectId ?? undefined, this.webSearch)
    const ollamaTools = buildOllamaTools(tools)

    const priorMsgs = priorMessages || []
    const sourceIds = sourceMessageIds || []

    // Emit context usage so the UI can show a progress bar
    const systemTokens = estimateTokens(systemPrompt)
    const promptTokens = estimateTokens(prompt)
    const priorTokens = estimateMessagesTokens(priorMsgs)
    const toolTokens = estimateTokens(JSON.stringify(ollamaTools))
    eventSink.emit(AgentEventType.ContextUsage, {
      systemTokens,
      messageTokens: priorTokens,
      promptTokens,
      toolTokens,
      contextWindow: this.contextWindow,
    })

    // Build messages: system + prior conversation + current prompt
    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    // Track prior message objects so we can identify which ones were removed by compaction
    const priorMessageObjects: OllamaMessage[] = []

    for (const m of priorMsgs) {
      if (m.role === 'user' || m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: m.role, content: m.content }
        if (m.tool_calls) msg.tool_calls = m.tool_calls
        messages.push(msg as OllamaMessage)
        priorMessageObjects.push(msg as OllamaMessage)
      } else if (m.role === 'tool') {
        const msg: Record<string, unknown> = { role: 'tool', content: m.content }
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
        if (m.name) msg.name = m.name
        messages.push(msg as OllamaMessage)
        priorMessageObjects.push(msg as OllamaMessage)
      } else if (m.role === 'system') {
        // Compaction summary message from the client — preserve it
        const msg: Record<string, unknown> = { role: 'system', content: m.content }
        messages.push(msg as OllamaMessage)
        priorMessageObjects.push(msg as OllamaMessage)
      }
    }

    messages.push({ role: 'user', content: prompt })

    // If resuming a plan, inject resume context before the current prompt
    if (planResume && activePlan) {
      const completedCount = planResume.todos.filter(t => t.status === 'completed').length
      const total = planResume.todos.length
      const todoLines = planResume.todos.map(t => {
        const marker = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]'
        return `${marker} ${t.subject} — ${t.description}`
      }).join('\n')

      const resumeMessage = `[RESUME — Active Plan: "${planResume.slug}"]\n\nI was previously working on: "${planResume.originalPrompt}"\n\nHere is the plan I was following:\n\n${activePlan.planMarkdown}\n\nCurrent task progress (${completedCount}/${total} done):\n${todoLines}\n\nContinue executing the plan from the next pending task. Do NOT repeat completed steps.`

      // Insert before the current user prompt
      messages.splice(messages.length - 1, 0,
        { role: 'user', content: resumeMessage },
        { role: 'assistant', content: `Understood. I'll continue from where I left off, starting with "${planResume.nextTask}".` },
      )
    }

    // Build plan resume re-injection content (used after compaction to restore plan context)
    let planResumeMessages: OllamaMessage[] | null = null
    if (planResume && activePlan) {
      const completedCount = planResume.todos.filter(t => t.status === 'completed').length
      const total = planResume.todos.length
      const todoLines = planResume.todos.map(t => {
        const marker = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]'
        return `${marker} ${t.subject} — ${t.description}`
      }).join('\n')

      const resumeMsg = `[RESUME — Active Plan: "${planResume.slug}"]\n\nI was previously working on: "${planResume.originalPrompt}"\n\nHere is the plan I was following:\n\n${activePlan.planMarkdown}\n\nCurrent task progress (${completedCount}/${total} done):\n${todoLines}\n\nContinue executing the plan from the next pending task. Do NOT repeat completed steps.`

      planResumeMessages = [
        { role: 'user', content: resumeMsg },
        { role: 'assistant', content: `Understood. I'll continue from where I left off, starting with "${planResume.nextTask}".` },
      ]
    }

    // Agent loop
    const maxIterations = 500
    const maxLoopRetries = 3
    let loopRetryCount = 0
    const recentToolCalls: string[] = []  // Track tool call signatures for deduplication
    let todoList: AuraTodoItem[] = planResume ? [...planResume.todos] : []
    let compactionFailures = 0
    for (let i = 0; i < maxIterations; i++) {
      if (this.abortController.signal.aborted) {
        eventSink.emit('done', {})
        return
      }

      // Compact messages if context is getting too large
      const totalTokensBefore = estimateTokens(systemPrompt) + estimateMessagesTokens(messages)
      if (totalTokensBefore > this.contextWindow * COMPACT_THRESHOLD) {
        eventSink.emit(AgentEventType.Status, { status: 'compacting' })
      }
      const compactResult = await compactMessagesAsync(messages, systemPrompt, todoList, this.contextWindow, this.ollamaBaseUrl, this.model, compactionFailures, planResume)
      if (compactResult.messages !== messages) {
        messages.length = 0
        messages.push(...compactResult.messages)

        // Re-inject plan resume messages if they were compacted away
        if (planResumeMessages && i === 0) {
          // Only on the first iteration — after that, the compaction summary should capture plan state
          const hasResumeContent = messages.some(m =>
            m.role === 'user' && m.content.includes('[RESUME')
          )
          if (!hasResumeContent) {
            // Insert before the last user message (the current prompt)
            const lastUserIdx = messages.findLastIndex(m => m.role === 'user')
            if (lastUserIdx >= 0) {
              messages.splice(lastUserIdx, 0, ...planResumeMessages)
            } else {
              messages.push(...planResumeMessages)
            }
          }
        }

        // Emit updated context usage after compaction
        const postCompactTokens = estimateTokens(systemPrompt) + estimateMessagesTokens(messages)
        eventSink.emit(AgentEventType.ContextUsage, {
          systemTokens: estimateTokens(systemPrompt),
          messageTokens: estimateMessagesTokens(messages),
          promptTokens: 0,
          toolTokens: estimateTokens(JSON.stringify(ollamaTools)),
          contextWindow: this.contextWindow,
          compacted: true,
          preCompactTokens: totalTokensBefore,
          postCompactTokens,
        })

        // Persist compaction checkpoint to chat.json
        if (compactResult.checkpoint && this.chatService && this.chatId) {
          // Determine which prior messages were removed by compaction
          // by checking which prior message objects are no longer in the compacted result
          const keptMessageSet = new Set(compactResult.messages)
          const coveredIds = new Set<string>()
          for (let i = 0; i < priorMessageObjects.length; i++) {
            if (!keptMessageSet.has(priorMessageObjects[i]) && i < sourceIds.length && sourceIds[i] !== '__compaction_summary__') {
              coveredIds.add(sourceIds[i])
            }
          }

          const checkpoint: CompactionCheckpoint = {
            createdAt: new Date().toISOString(),
            summary: compactResult.checkpoint.summary,
            aiGenerated: compactResult.checkpoint.aiGenerated,
            coveredMessageIds: [...coveredIds],
            summaryTokens: compactResult.checkpoint.summaryTokens,
          }
          try {
            await this.chatService.saveCheckpoints(this.projectPath, this.chatId, [checkpoint])
          } catch { /* best-effort persistence */ }

          eventSink.emit(AgentEventType.Compaction, {
            createdAt: checkpoint.createdAt,
            summary: checkpoint.summary,
            aiGenerated: checkpoint.aiGenerated,
            coveredMessageIds: checkpoint.coveredMessageIds,
            summaryTokens: checkpoint.summaryTokens,
          })
        }
      }
      compactionFailures = compactResult.compactionFailures

      const result = await this.streamChat(messages, ollamaTools, eventSink)

      if (!result) {
        if (loopRetryCount < maxLoopRetries) {
          loopRetryCount++
          if (loopRetryCount === 1) eventSink.emit('token', { content: `Lost response, retrying…` })
          continue  // Retry from the same position — messages are preserved
        }
        eventSink.emit('done', {})
        return
      }

      // Reset retry counter on successful response
      loopRetryCount = 0

      // Add assistant message to history
      messages.push({
        role: 'assistant',
        content: result.content,
        ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.args } })) } : {}),
      })

      // If no tool calls, we're done
      if (result.toolCalls.length === 0) {
        eventSink.emit('done', {})
        return
      }

      // Deduplication: check if the model is repeating the same tool call
      const currentCallKeys = result.toolCalls.map(tc => `${tc.name}:${JSON.stringify(tc.args)}`)
      const repeatedCalls = currentCallKeys.filter(key => recentToolCalls.includes(key))
      if (repeatedCalls.length > 0) {
        // Keep only non-repeated calls
        const nonRepeatedCalls = result.toolCalls.filter(tc => {
          const key = `${tc.name}:${JSON.stringify(tc.args)}`
          return !recentToolCalls.includes(key)
        })

        if (nonRepeatedCalls.length === 0) {
          // All calls are repeats — inject a nudge to try differently
          messages.push({
            role: 'user',
            content: 'You are repeating the same tool calls that didn\'t resolve the issue. Try a completely different approach — use different tools, read the file first to understand the actual content, or break the problem down differently.',
          })
          continue
        }
        // Keep only the non-repeated calls
        result.toolCalls = nonRepeatedCalls
      }

      // Track current calls for deduplication
      recentToolCalls.push(...currentCallKeys)
      if (recentToolCalls.length > 20) recentToolCalls.splice(0, recentToolCalls.length - 20)

      // Handle dispatch_sub_agents specially
      const subAgentCall = result.toolCalls.find(tc => tc.name === 'dispatch_sub_agents')
      if (subAgentCall) {
        let tasks = (subAgentCall.args as { tasks?: unknown }).tasks
        if (typeof tasks === 'string') {
          try { tasks = JSON.parse(tasks) } catch { tasks = [] }
        }
        if (!Array.isArray(tasks)) tasks = []
        const subResults = await this.runSubAgents(tasks, systemPrompt, ollamaTools, eventSink, context)

        // Build structured sub-agent results
        let subResultText = '## Sub-Agent Research Results\n\n'
        for (const sr of subResults) {
          subResultText += `### ${sr.focus}\n${sr.result}\n\n---\n\n`
        }
        subResultText += '\nBased on all sub-agent research above, provide a comprehensive, well-structured answer to the original question. Use headings, bullet points, and code examples where appropriate. Cite specific files, symbols, and relationships found by the sub-agents.'

        messages.push({
          role: 'tool',
          content: subResultText,
          tool_call_id: subAgentCall.id || `dispatch_sub_agents_${i}`,
          name: 'dispatch_sub_agents',
        })

        // If any sub-agent was a planner, present the plan for user approval
        const planTask = tasks.find((t: SubAgentTask) => t.type === 'plan')
        if (planTask) {
          const planResult = subResults.find(sr => sr.focus === planTask.focus)
          if (planResult) {
            const planApprovalId = `plan_${Date.now()}`
            const planApproval = await this.approvalManager.requestApproval(
              planApprovalId,
              eventSink,
              'plan',
              { planMarkdown: planResult.result },
            )
            if (!planApproval.approved) {
              if (planApproval.feedback) {
                // User suggested edits — re-inject the feedback and let the model re-plan
                messages.push({
                  role: 'user',
                  content: `The user reviewed your plan and suggests the following changes:\n\n${planApproval.feedback}\n\nHere is the original plan for reference:\n\n${planResult.result}\n\nPlease revise the plan accordingly.`,
                })
                continue
              }
              // User rejected outright
              eventSink.emit('done', {})
              return
            }
            // Plan approved — save it for persistence
            try {
              await planService.savePlan(this.projectPath, {
                slug,
                originalPrompt: prompt,
                branchName: currentBranch || `aura/${slug}`,
                planMarkdown: planResult.result,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                todos: [],
              })
              activePlan = {
                slug,
                originalPrompt: prompt,
                branchName: currentBranch || `aura/${slug}`,
                planMarkdown: planResult.result,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                todos: [],
              }
            } catch { /* plan save is best-effort */ }
          }
        }

        continue
      }

      // Handle todo_write specially — update internal state and emit SSE
      const todoCall = result.toolCalls.find(tc => tc.name === 'todo_write')
      if (todoCall) {
        let todos = (todoCall.args as { todos?: unknown }).todos
        if (typeof todos === 'string') {
          try { todos = JSON.parse(todos) } catch { todos = [] }
        }
        if (!Array.isArray(todos)) todos = []
        todoList = todos as AuraTodoItem[]
        eventSink.emit('todo_update', { todos: todoList })
        messages.push({
          role: 'tool',
          content: JSON.stringify({ acknowledged: true, todoCount: todoList.length }),
          tool_call_id: todoCall.id || `todo_write_${i}`,
          name: 'todo_write',
        })
        // Remove todo_write from tool calls so it doesn't get executed below
        result.toolCalls = result.toolCalls.filter(tc => tc.name !== 'todo_write')

        // Persist todo state to plan file
        try {
          if (activePlan) {
            activePlan.todos = todoList
            activePlan.updatedAt = new Date().toISOString()
            await planService.savePlan(this.projectPath, activePlan)

            // If all todos are completed, clean up the plan
            if (todoList.length > 0 && todoList.every(t => t.status === 'completed')) {
              await planService.deletePlan(this.projectPath, activePlan.slug)
              eventSink.emit('plan_completed' as any, { slug: activePlan.slug, originalPrompt: activePlan.originalPrompt })
              activePlan = null
              planResume = null
            }
          } else if (todoList.length > 0) {
            // No saved plan yet — create one (model skipped the plan sub-agent)
            activePlan = {
              slug,
              originalPrompt: prompt,
              branchName: currentBranch || `aura/${slug}`,
              planMarkdown: '(No formal plan — model created todos directly)',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              todos: todoList,
            }
            await planService.savePlan(this.projectPath, activePlan)
          }
        } catch { /* todo persistence is best-effort */ }
      }

      // Handle ask_user — pause for user response
      const askCall = result.toolCalls.find(tc => tc.name === 'ask_user')
      if (askCall) {
        const question = (askCall.args as { question?: string }).question || ''
        let options = (askCall.args as { options?: unknown }).options
        if (typeof options === 'string') {
          try { options = JSON.parse(options) } catch { options = [] }
        }
        if (!Array.isArray(options)) options = []

        // Emit tool_call so the frontend creates a proper tool call entry
        const askCallId = askCall.id || `ask_user_${i}`
        eventSink.emit('tool_call', { name: 'ask_user', args: askCall.args, tool_call_id: askCallId })

        const approvalId = `question_${Date.now()}`
        const approval = await this.approvalManager.requestApproval(
          approvalId,
          eventSink,
          'question',
          { question, options },
        )

        const answer = approval.feedback || (approval.approved ? 'User approved' : 'User declined')
        messages.push({
          role: 'tool',
          content: answer,
          tool_call_id: askCallId,
          name: 'ask_user',
        })
        // Emit tool_result so the frontend updates status and stores the Q&A
        eventSink.emit('tool_result', { name: 'ask_user', result: { question, answer }, tool_call_id: askCallId })
        result.toolCalls = result.toolCalls.filter(tc => tc.name !== 'ask_user')
      }

      // Handle visual_preview — write HTML fragment and emit visual_content event
      const visualCall = result.toolCalls.find(tc => tc.name === 'visual_preview')
      if (visualCall) {
        // Emit tool_call so the frontend creates a proper tool call entry
        const visualCallId = visualCall.id || `visual_preview_${i}`
        eventSink.emit('tool_call', { name: 'visual_preview', args: visualCall.args, tool_call_id: visualCallId })

        const args = visualCall.args as { filename?: string; content?: string; title?: string }
        const filename = args.filename || 'screen'
        const content = args.content || ''
        const title = args.title || 'Visual Preview'
        try {
          const result_info = await writeScreen(this.projectPath, filename, content, title, this.projectId ?? undefined)
          const url = result_info.url
          eventSink.emit(AgentEventType.VisualContent, { url, title, filename })
          messages.push({
            role: 'tool',
            content: JSON.stringify({ url, screenDir: result_info.screenDir, stateDir: result_info.stateDir, filename }),
            tool_call_id: visualCallId,
            name: 'visual_preview',
          })
          eventSink.emit('tool_result', { name: 'visual_preview', result: { url, filename, title }, tool_call_id: visualCallId })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: `Failed to write visual preview: ${errorMsg}` }),
            tool_call_id: visualCallId,
            name: 'visual_preview',
          })
          eventSink.emit('tool_result', { name: 'visual_preview', error: errorMsg, tool_call_id: visualCallId })
        }
        result.toolCalls = result.toolCalls.filter(tc => tc.name !== 'visual_preview')
      }

      // Handle read_visual_events — read user interactions from visual companion
      const readEventsCall = result.toolCalls.find(tc => tc.name === 'read_visual_events')
      if (readEventsCall) {
        // Emit tool_call so the frontend creates a proper tool call entry
        const readEventsCallId = readEventsCall.id || `read_visual_events_${i}`
        eventSink.emit('tool_call', { name: 'read_visual_events', args: readEventsCall.args || {}, tool_call_id: readEventsCallId })

        try {
          const events = await readVisualEvents(this.projectPath)
          messages.push({
            role: 'tool',
            content: JSON.stringify({ events }),
            tool_call_id: readEventsCallId,
            name: 'read_visual_events',
          })
          eventSink.emit('tool_result', { name: 'read_visual_events', result: { events }, tool_call_id: readEventsCallId })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: `Failed to read visual events: ${errorMsg}` }),
            tool_call_id: readEventsCallId,
            name: 'read_visual_events',
          })
          eventSink.emit('tool_result', { name: 'read_visual_events', error: errorMsg, tool_call_id: readEventsCallId })
        }
        result.toolCalls = result.toolCalls.filter(tc => tc.name !== 'read_visual_events')
      }

      // Handle load_skill — read skill file and inject as tool result
      const loadSkillCall = result.toolCalls.find(tc => tc.name === 'load_skill')
      if (loadSkillCall) {
        // Emit tool_call so the frontend creates a proper tool call entry
        const loadSkillCallId = loadSkillCall.id || `load_skill_${i}`
        const skillName = (loadSkillCall.args as { skill?: string }).skill || ''
        eventSink.emit('tool_call', { name: 'load_skill', args: loadSkillCall.args, tool_call_id: loadSkillCallId, purpose: `Skill: ${skillName}` })

        const validSkills = ['aura-building', 'aura-exploring', 'aura-impact', 'aura-debugging', 'aura-refactoring', 'aura-visual']
        if (validSkills.includes(skillName)) {
          try {
            const skillPath = path.resolve(process.cwd(), 'server', 'skills', skillName, 'SKILL.md')
            const skillContent = await fs.readFile(skillPath, 'utf-8')
            messages.push({
              role: 'tool',
              content: `Skill loaded. Here is the guidance:\n\n${skillContent}`,
              tool_call_id: loadSkillCallId,
              name: 'load_skill',
            })
            eventSink.emit('tool_result', { name: 'load_skill', result: `Skill: ${skillName} loaded successfully`, tool_call_id: loadSkillCallId })
          } catch {
            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: `Failed to load skill "${skillName}": file not found` }),
              tool_call_id: loadSkillCallId,
              name: 'load_skill',
            })
            eventSink.emit('tool_result', { name: 'load_skill', error: `Skill "${skillName}" not found`, tool_call_id: loadSkillCallId })
          }
        } else {
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: `Unknown skill "${skillName}". Valid skills: ${validSkills.join(', ')}` }),
            tool_call_id: loadSkillCallId,
            name: 'load_skill',
          })
          eventSink.emit('tool_result', { name: 'load_skill', error: `Unknown skill "${skillName}"`, tool_call_id: loadSkillCallId })
        }
        result.toolCalls = result.toolCalls.filter(tc => tc.name !== 'load_skill')
      }

      // Handle close_visual — stop the companion and emit close event
      const closeVisualCall = result.toolCalls.find(tc => tc.name === 'close_visual')
      if (closeVisualCall) {
        // Emit tool_call so the frontend creates a proper tool call entry
        const closeVisualCallId = closeVisualCall.id || `close_visual_${i}`
        eventSink.emit('tool_call', { name: 'close_visual', args: closeVisualCall.args || {}, tool_call_id: closeVisualCallId })

        try {
          await stopVisualCompanion(this.projectPath)
          eventSink.emit(AgentEventType.VisualClose, {})
          messages.push({
            role: 'tool',
            content: JSON.stringify({ acknowledged: true }),
            tool_call_id: closeVisualCallId,
            name: 'close_visual',
          })
          eventSink.emit('tool_result', { name: 'close_visual', result: { acknowledged: true }, tool_call_id: closeVisualCallId })
        } catch {
          messages.push({
            role: 'tool',
            content: JSON.stringify({ acknowledged: true }),
            tool_call_id: closeVisualCallId,
            name: 'close_visual',
          })
          eventSink.emit('tool_result', { name: 'close_visual', result: { acknowledged: true }, tool_call_id: closeVisualCallId })
        }
        result.toolCalls = result.toolCalls.filter(tc => tc.name !== 'close_visual')
      }

      // Execute regular tool calls
      let hasFileEdits = false
      for (const tc of result.toolCalls) {
        if (tc.name === 'dispatch_sub_agents') continue
        if (tc.name === 'todo_write') continue
        if (tc.name === 'visual_preview') continue
        if (tc.name === 'read_visual_events') continue
        if (tc.name === 'load_skill') continue
        if (tc.name === 'close_visual') continue

        if (tc.name === 'write' || tc.name === 'update') {
          hasFileEdits = true
        }

        const tool = tools.find(t => t.name === tc.name)
        if (!tool) {
          eventSink.emit('tool_result', { name: tc.name, error: `Unknown tool: ${tc.name}`, tool_call_id: `${tc.id || `${tc.name}_${i}`}` })
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
            tool_call_id: `${tc.id || `${tc.name}_${i}`}`,
            name: tc.name,
          })
          continue
        }

        eventSink.emit('tool_call', { name: tc.name, args: tc.args, tool_call_id: `${tc.id || `${tc.name}_${i}`}` })

        // Check if this is an execute command that needs approval
        if (tc.name === 'execute') {
          const command = (tc.args as { command?: string }).command || ''
          for (const { pattern, description, riskLevel } of DANGEROUS_COMMAND_DESCRIPTIONS) {
            if (pattern.test(command)) {
              const approvalId = `exec_${Date.now()}_${i}`
              const approval = await this.approvalManager.requestApproval(
                approvalId,
                eventSink,
                'command',
                { command, description, riskLevel, cwd: this.projectPath },
              )
              if (!approval.approved) {
                const denyMsg = `Command denied by user: "${command}". ${approval.reason || ''}`
                eventSink.emit('tool_result', { name: tc.name, error: denyMsg, tool_call_id: `${tc.id || `${tc.name}_${i}`}` })
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({ error: denyMsg }),
                  tool_call_id: `${tc.id || `${tc.name}_${i}`}`,
                  name: tc.name,
                })
                // Skip execution for this tool call
                tc = null as any
                break
              }
              break // Only need to match one pattern
            }
          }
          if (tc === null) continue
        }

        // Check if this is a git command that needs approval
        if (tc.name === 'git') {
          const gitArgs = (tc.args as { args?: string }).args || ''
          const fullGitCommand = `git ${gitArgs}`
          for (const { pattern, description, riskLevel } of DANGEROUS_COMMAND_DESCRIPTIONS) {
            if (pattern.test(fullGitCommand)) {
              const approvalId = `git_${Date.now()}_${i}`
              const approval = await this.approvalManager.requestApproval(
                approvalId,
                eventSink,
                'command',
                { command: fullGitCommand, description, riskLevel, cwd: this.projectPath },
              )
              if (!approval.approved) {
                const denyMsg = `Git command denied by user: "${fullGitCommand}". ${approval.reason || ''}`
                eventSink.emit('tool_result', { name: tc.name, error: denyMsg, tool_call_id: `${tc.id || `${tc.name}_${i}`}` })
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({ error: denyMsg }),
                  tool_call_id: `${tc.id || `${tc.name}_${i}`}`,
                  name: tc.name,
                })
                tc = null as any
                break
              }
              break // Only need to match one pattern
            }
          }
          if (tc === null) continue
        }

        try {
          const toolResult = await tool.execute(tc.args as Record<string, unknown>)
          const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
          eventSink.emit('tool_result', { name: tc.name, result: toolResult, tool_call_id: `${tc.id || `${tc.name}_${i}`}` })
          messages.push({
            role: 'tool',
            content: resultStr,
            tool_call_id: `${tc.id || `${tc.name}_${i}`}`,
            name: tc.name,
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          eventSink.emit('tool_result', { name: tc.name, error: errorMsg, tool_call_id: `${tc.id || `${tc.name}_${i}`}` })
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: errorMsg }),
            tool_call_id: `${tc.id || `${tc.name}_${i}`}`,
            name: tc.name,
          })
        }
      }

      // Verification: after file edits, nudge the model to verify
      if (hasFileEdits) {
        messages.push({
          role: 'user',
          content: 'Verify your changes: read the modified files back using read_file and/or run build/test commands using execute. If the edit failed or the same issue persists, try a completely different approach — do NOT repeat the same edit.',
        })
      }
    }

    // Hit iteration limit
    eventSink.emit('done', {})
  }

  private async streamChat(
    messages: OllamaMessage[],
    tools: OllamaTool[],
    eventSink: AgentEventSink,
  ): Promise<{ content: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> } | null> {
    const maxRetries = 5
    let lastError: string = ''

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.abortController?.signal.aborted) return null

      try {
        const payload = {
          model: this.model,
          messages: messages.map(m => {
            const msg: Record<string, unknown> = { role: m.role, content: m.content }
            if (m.tool_calls) msg.tool_calls = m.tool_calls
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
            if (m.name) msg.name = m.name
            return msg
          }),
          tools: tools.length > 0 ? tools : undefined,
          stream: true,
          options: { num_ctx: this.contextWindow },
        }
        const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: this.abortController?.signal,
        })

        if (!response.ok || !response.body) {
          const errText = await response.text().catch(() => response.statusText)
          lastError = `${response.status} ${errText}`
          // Don't retry on rate limits — show the error immediately
          if (response.status === 429) {
            eventSink.emit('error', { message: `Ollama chat failed: ${lastError}` })
            return null
          }
          // Retry on server errors (5xx), not on client errors (4xx)
          if (response.status >= 500) {
            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
              if (attempt === 1) eventSink.emit('token', { content: `Connection interrupted, retrying…` })
              await new Promise(r => setTimeout(r, delay))
              continue
            }
          }
          eventSink.emit('error', { message: `Ollama chat failed: ${lastError}` })
          return null
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let fullContent = ''
        let buffer = ''
        const toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              if (parsed.message?.content) {
                fullContent += parsed.message.content
                eventSink.emit('token', { content: parsed.message.content })
              }
              if (parsed.message?.tool_calls) {
                for (const tc of parsed.message.tool_calls) {
                  let args: Record<string, unknown> = {}
                  try {
                    args = typeof tc.function.arguments === 'string'
                      ? JSON.parse(tc.function.arguments)
                      : tc.function.arguments || {}
                  } catch {
                    args = {}
                  }
                  toolCalls.push({ name: tc.function.name, args, id: tc.id })
                }
              }
            } catch {
              // Skip malformed lines
            }
          }
        }

        return { content: fullContent, toolCalls }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return null
        lastError = (err as Error).message

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
          if (attempt === 1) eventSink.emit('token', { content: `Connection error, retrying…` })
          await new Promise(r => setTimeout(r, delay))
          continue
        }

        eventSink.emit('error', { message: `Ollama request failed after ${maxRetries} retries: ${lastError}` })
        return null
      }
    }

    return null
  }

  private async runSubAgents(
    tasks: SubAgentTask[],
    systemPrompt: string,
    ollamaTools: OllamaTool[],
    eventSink: AgentEventSink,
    context?: Record<string, unknown>,
  ): Promise<Array<{ focus: string; result: string }>> {
    const allTools = defineAgentTools(this.qs, this.projectPath, this.managedShells ?? undefined, this.projectId ?? undefined, this.webSearch)
    const maxSubIterations = 100

    const runOne = async (taskIndex: number, task: SubAgentTask): Promise<string> => {
      const agentType: SubAgentType = task.type || 'explore'
      const taskId = `sa_${taskIndex}_${task.focus}`
      eventSink.emit('sub_agent_start', { taskId, title: task.title, task: task.task, type: agentType, startTime: Date.now() })

      // Build lean system prompt for sub-agents: base tool instructions only, no user context/skills/plan
      const agentPrompt = SUB_AGENT_SYSTEM_PROMPTS[agentType]
      const subSystemPrompt = `You are AURA — a sub-agent operating on the user's codebase.

${agentPrompt}

## How to Investigate

1. Use tools to gather facts before answering. Break complex questions into steps and call tools in sequence.
2. When exploring unfamiliar code, start with \`context_manifest\` → \`context_folder\` for a quick overview, then drill into specific symbols with \`search\` → \`context\`.
3. Always verify claims against actual source code using \`search_pattern\`. The indexed data can have gaps — especially for re-exports, dynamic imports, and CommonJS patterns.
4. When answering "is X used?", "who imports X?", or "is X unused?" — ALWAYS run \`search_pattern\` to confirm, even if the graph shows an answer.

## Limitations

- The dependency graph indexes JavaScript (.js, .jsx, .mjs, .cjs), TypeScript (.ts, .tsx), Python (.py), CSS (.css), SCSS/Sass (.scss, .sass), HTML (.html, .htm), Vue SFC (.vue), PHP (.php), Java (.java), C (.c, .h), C++ (.cpp, .cxx, .cc, .hpp, .hxx, .hh), C# (.cs), Go (.go), Rust (.rs), Less (.less), and Shell (.sh, .bash, .zsh), Dart (.dart), and Kotlin (.kt, .kts) files. For any other language (JSON, Markdown, SQL, XML, YAML, etc.), use \`read_file\`, \`search_pattern\`, and \`search_web\` instead of graph tools.
- If the graph doesn't index the language you're analyzing, say so clearly: "The dependency graph doesn't index [language] files, so I'll use file search and reading instead."

## Folder Context Files

The project has AI-generated context files in \`project_dir/.aura/contexts/\`. Each describes a folder's role, exports, dependencies, and summary in this format:

# <folder-path>
## Role — what the folder does
## Exports — files and what they export
## Dependencies — imports from / imported by
## Summary — human-readable overview

When exploring unfamiliar areas, call \`context_manifest\` first to see all available folders, then \`context_folder\` for specific ones.

## How to Respond

- Cite specific symbols, files, and relationships — use inline code for paths (\`src/auth.ts:login\`) and fenced code blocks for snippets.
- Structure your answer with markdown headings, bold, and bullet lists. Don't dump unformatted text.
- Be concise but complete. Prefer specific facts over vague summaries.

Node ID format: \`filePath:symbolName\` (e.g., \`src/auth.ts:login\`), or just \`filePath\` for File nodes, or \`filePath:METHOD /path\` for Route nodes.

Focus on: ${task.focus}`

      // Filter tools based on agent type
      const allowedTools = TOOL_ACCESS[agentType]
      const filteredTools = allTools.filter(t => allowedTools.includes(t.name))
      const filteredOllamaTools = buildOllamaTools(filteredTools)

      const messages: OllamaMessage[] = [
        { role: 'system', content: subSystemPrompt },
      ]

      // If the main agent provided pre-context, inject it as a second system message
      if (task.preContext) {
        messages.push({ role: 'system', content: `## Pre-Context\n\nThe main agent has provided the following context from its ongoing investigation. Use this as background — you do not need to re-discover these facts.\n\n${task.preContext}` })
      }

      messages.push({ role: 'user', content: task.task })

      let lastContent = ''
      let toolsUsed = 0
      for (let i = 0; i < maxSubIterations; i++) {
        const subSink = new SilentEventSink()
        const result = await this.streamChat(messages, filteredOllamaTools, subSink)
        if (result?.content) lastContent = result.content

        if (!result || result.toolCalls.length === 0) {
          const tokensUsed = estimateMessagesTokens(messages)
          const finalContent = result?.content || lastContent || 'No findings'
          eventSink.emit('sub_agent_result', { taskId, result: finalContent, toolsUsed, tokensUsed })
          return finalContent
        }

        // On the last iteration, return whatever content the model produced alongside tool calls
        if (i === maxSubIterations - 1) {
          const summary = lastContent || 'Sub-agent ran out of iterations before producing a final summary'
          const tokensUsed = estimateMessagesTokens(messages)
          eventSink.emit('sub_agent_result', { taskId, result: summary, toolsUsed, tokensUsed })
          return summary
        }

        messages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.args } })),
        })

        for (const tc of result.toolCalls) {
          toolsUsed++
          const tool = filteredTools.find(t => t.name === tc.name)
          if (!tool) continue
          try {
            const toolResult = await tool.execute(tc.args as Record<string, unknown>)
            const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
            messages.push({ role: 'tool', content: resultStr, tool_call_id: `${tc.name}_sub_${i}`, name: tc.name })
          } catch (err) {
            messages.push({ role: 'tool', content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), tool_call_id: `${tc.name}_sub_${i}`, name: tc.name })
          }
        }
      }

      // Unreachable, but just in case
      const tokensUsed = estimateMessagesTokens(messages)
      eventSink.emit('sub_agent_result', { taskId, result: lastContent || 'No findings', toolsUsed, tokensUsed })
      return lastContent || 'No findings'
    }

    // Run sub-agents in parallel
    const results = await Promise.allSettled(
      tasks.map((task, index) => runOne(index, task)),
    )

    // Emit result events for any rejected sub-agents (fulfilled ones already emitted inside runOne)
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        eventSink.emit('sub_agent_result', {
          taskId: `sa_${i}_${tasks[i].focus}`,
          result: r.reason instanceof Error ? r.reason.message : 'Sub-agent failed',
          status: 'error',
          toolsUsed: 0,
          tokensUsed: 0,
        })
      }
    })

    return results.map((r, i) => ({
      focus: tasks[i].focus,
      result: r.status === 'fulfilled' ? r.value : 'Sub-agent failed',
    }))
  }

  private availabilityCache: { available: boolean; timestamp: number } | null = null

  async checkAvailability(): Promise<boolean> {
    const now = Date.now()
    if (this.availabilityCache && now - this.availabilityCache.timestamp < 60000) {
      return this.availabilityCache.available
    }

    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      })
      const available = response.ok
      this.availabilityCache = { available, timestamp: now }
      return available
    } catch {
      this.availabilityCache = { available: false, timestamp: now }
      return false
    }
  }
}