import path from 'path'
import fs from 'fs/promises'
import { rmSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Response } from 'express'
import type { AuraQueryService } from './graph.ts'
import type { AgentEventSink } from './sse.ts'
import { SilentEventSink } from './sse.ts'
import { buildCrawlArgs, buildDesignCrawlArgs } from './crawl.ts'
import { PlanPersistenceService, type SavedPlan } from './plan-persistence.ts'

const execFileAsync = promisify(execFile)

// ── Token estimation ────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_WINDOW = 200_000

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
}

// ── Context compaction ──────────────────────────────────────────────────────

const COMPACT_THRESHOLD = 0.6 // Compact when tokens exceed 60% of context window
const KEEP_RECENT_MESSAGES = 8 // Keep last N messages during compaction

function compactMessages(
  messages: OllamaMessage[],
  systemPrompt: string,
  todoList: AuraTodoItem[],
  contextWindow: number,
  planResume?: PlanResumeContext | null,
): OllamaMessage[] {
  const totalTokens = estimateTokens(systemPrompt) + estimateMessagesTokens(messages)
  if (totalTokens <= contextWindow * COMPACT_THRESHOLD) {
    return messages // No compaction needed
  }

  // If messages are too few to compact, just return them as-is
  // (the num_ctx parameter will give Ollama enough room)
  if (messages.length <= KEEP_RECENT_MESSAGES + 2) {
    return messages
  }

  // Build compaction summary from messages we're about to remove
  const cutoff = messages.length - KEEP_RECENT_MESSAGES
  const removedMessages = messages.slice(1, cutoff) // Skip system message at index 0

  let summary = '## Previous Work (Compacted)\n\nThe earlier part of this conversation has been summarized to save context space.\n\nKey completed work:\n'

  if (planResume) {
    const pending = planResume.todos.filter(t => t.status !== 'completed')
    summary += `\nContinuing plan "${planResume.slug}". ${planResume.todos.filter(t => t.status === 'completed').length}/${planResume.todos.length} tasks done. Next: "${planResume.nextTask || 'none'}".\n`
  }

  for (const m of removedMessages) {
    if (m.role === 'assistant' && m.content) {
      const snippet = m.content.slice(0, 300).trim()
      if (snippet) summary += `- ${snippet}\n`
    }
    if (m.role === 'tool') {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      // Skip todo_write acknowledgments and very long results
      if (content.startsWith('{"acknowledged":true')) continue
      const snippet = content.slice(0, 150).trim()
      if (snippet) summary += `  (tool result: ${snippet}...)\n`
    }
  }

  // Always include current todo list state
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

  const recentMessages = messages.slice(-KEEP_RECENT_MESSAGES)
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: summary },
    ...recentMessages,
  ]
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
  task: string
  focus: string
  type?: SubAgentType
}

interface AuraTodoItem {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy?: string[]
}

type SubAgentType = 'explore' | 'research' | 'fix' | 'plan'

const SUB_AGENT_SYSTEM_PROMPTS: Record<SubAgentType, string> = {
  explore: 'You are an exploration agent. Investigate the codebase to answer the question. Use tools to find facts — search for symbols, trace dependencies, read files. Return a detailed report with specific file paths, symbol names, and line numbers. Do not make any edits.',
  research: 'You are a research agent. Find information from the web and codebase. Use search_web for URLs and queries, context tools for codebase overview. Return a comprehensive summary of your findings with sources.',
  fix: 'You are a fix agent. Read the relevant code, make targeted edits using update or write, then VERIFY your changes — read the file back to confirm correctness, and run build/test commands if available using execute. If the fix doesn\'t work, try a completely different approach — never repeat the same edit. Return: (1) what you changed, (2) verification that the change is correct, (3) any remaining issues.',
  plan: 'You are a planning agent. Analyze the task, explore the codebase, and produce a step-by-step implementation plan. Your output MUST follow this structured format:\n\n## Implementation Plan\n\n### Step N: [Title]\n- **Files to modify**: [list of file paths]\n- **Changes**: [description of what to change]\n- **Dependencies**: [list of step numbers this depends on, or "none"]\n\nAfter all steps, include:\n### Verification\n- [list of verification steps: build commands, test commands, manual checks]\n\nDo NOT make any edits — only investigate and plan. Be specific: cite exact file paths, function names, and line numbers. The main agent will create a todo list from your plan and execute each step.',
}

const TOOL_ACCESS: Record<SubAgentType, string[]> = {
  explore: ['search', 'context', 'impact', 'dependents', 'dependencies', 'route_map', 'tool_map', 'shape_check', 'api_impact', 'processes', 'process_detail', 'context_manifest', 'context_folder', 'get_graph', 'read_file', 'search_pattern'],
  research: ['search_web', 'context_manifest', 'context_folder', 'read_file', 'search_pattern', 'search'],
  fix: ['search', 'context', 'impact', 'dependents', 'dependencies', 'read_file', 'search_pattern', 'update', 'write', 'execute', 'search_web'],
  plan: ['search', 'context', 'dependents', 'dependencies', 'context_manifest', 'context_folder', 'read_file', 'search_pattern', 'route_map', 'processes', 'search_web', 'get_graph'],
}

// Commands that are too dangerous to allow via execute
const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\/\b/i,
  /\brm\s+-rf\s+~\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b>\s*\/dev\//i,
  /\bcurl\s+.*\|\s*(ba)?sh\b/i,
  /\bwget\s+.*\|\s*(ba)?sh\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-f\b/i,
  /\bgit\s+branch\s+-[dD]\s+main\b/i,
  /\bgit\s+branch\s+-[dD]\s+master\b/i,
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

const NEEDS_APPROVAL_PATTERNS = [
  /\brm\s+-r\b/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+checkout\s+--\s*\./i,
  /\bgit\s+restore\s+--staged\b/i,
  /\bnpm\s+install\b/i,
  /\byarn\s+add\b/i,
  /\bpip\s+install\b/i,
  /\bcargo\s+add\b/i,
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
]

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

const INTENT_PATTERNS: Array<{ keywords: string[]; skill: string }> = [
  { keywords: ['build me', 'create a', 'scaffold', 'implement', 'add feature', 'set up a', 'new project', 'from scratch', 'build a', 'create new'], skill: 'aura-building' },
  { keywords: ['how', 'where', 'what does', 'understand', 'architecture', 'entry point', 'show me', 'explain', 'navigate', 'find'], skill: 'aura-exploring' },
  { keywords: ['break', 'safe', 'change', 'modify', 'impact', 'affect', 'risk', 'delete', 'remove', 'consequence'], skill: 'aura-impact' },
  { keywords: ['broken', 'error', 'fail', 'bug', 'trace', 'crash', 'fix', 'debug', 'issue', 'wrong', 'not working'], skill: 'aura-debugging' },
  { keywords: ['rename', 'move', 'extract', 'refactor', 'restructure', 'clean up', 'delete safely', 'simplify'], skill: 'aura-refactoring' },
]

function detectIntent(prompt: string): string[] {
  const lower = prompt.toLowerCase()
  const skills = new Set<string>(['aura-guide'])
  for (const { keywords, skill } of INTENT_PATTERNS) {
    if (keywords.some(k => lower.includes(k))) {
      skills.add(skill)
    }
  }
  return [...skills]
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

function buildSystemPrompt(skillContent: string, contextSection?: string, isGreenfield?: boolean, gitContext?: string, planResume?: PlanResumeContext): string {
  const greenfieldNote = isGreenfield
    ? '\nThis is a NEW project with no existing code. You are building from scratch.\n\n**IMPORTANT: Your FIRST action must be to create a proper `.gitignore` file for this project type.** Overwrite the placeholder .gitignore with appropriate entries (e.g., node_modules/, dist/, .env for Node.js; __pycache__/, .venv/, *.pyc for Python; etc.). Then commit it using `execute`: `git add .gitignore && git commit -m "chore: add .gitignore"`.\n\nAfter the .gitignore, proceed with creating the project structure (package.json, tsconfig, source files, etc.) and installing dependencies.\n'
    : '\nThis is an existing codebase. Use your investigation tools to understand it before making changes.\n'

  const gitNote = gitContext ? `\n${gitContext}\n` : ''

  return `You are AURA (Artificial Unified Responsive Assistant) — a builder agent connected to the user's codebase. Your primary role is to CREATE and BUILD: scaffolding projects, implementing features, fixing bugs, and refactoring code. You can also investigate and answer questions about the codebase when asked.
${greenfieldNote}${gitNote}
## How to Build

For any task that requires more than one file change:
1. **Plan first.** Dispatch a \`plan\` sub-agent to analyze the codebase and produce a step-by-step implementation plan.
2. **Create a todo list.** After receiving the plan, immediately call \`todo_write\` to create a structured task list. Break the plan into discrete, ordered steps.
3. **Work through todos sequentially.** For each todo:
   a. Mark it \`in_progress\` via \`todo_write\`
   b. Make the necessary file changes (using \`write\` for new files, \`update\` for existing)
   c. Verify the changes (read back files, run build/test commands via \`execute\`)
   d. Mark it \`completed\` via \`todo_write\`
   e. **Commit immediately** — run \`git add -A && git commit -m "type: description"\` via \`execute\`. This is MANDATORY. Do NOT skip this step. Every completed todo MUST result in a git commit. Use conventional commit prefixes: \`feat:\`, \`fix:\`, \`refactor:\`, \`chore:\`, \`docs:\`.
4. **Use feature branches.** When starting a build task, a feature branch will be created automatically. Stay on that branch for the entire build.

For quick fixes (single file, obvious change): skip the plan, just fix it directly.

## When to Use Sub-Agents vs Direct Tool Calls

- **Use sub-agents** for multi-step investigation (explore, research, plan) that can run in parallel
- **Use direct tool calls** for single focused operations (read a file, write a file, search for a symbol)
- **For build tasks**: always dispatch a \`plan\` sub-agent first, then execute the plan yourself

## Sub-Agents

When a question requires multiple independent tasks, use \`dispatch_sub_agents\` to fan out parallel agents. Choose the right type:

- **explore**: Investigate code — find symbols, trace dependencies, understand architecture. Read-only.
- **research**: Look up external info — documentation, APIs, examples via web search.
- **fix**: Make and verify code edits — reads files, makes changes, then verifies by reading back and running commands.
- **plan**: Analyze and plan — investigate the codebase and produce a structured implementation plan without making edits.

Do NOT use sub-agents for simple single-focus questions — call tools directly instead.

## Running Commands

Use the \`execute\` tool to run build, test, lint, and git commands. Always verify changes by:
1. Running relevant build/test commands after editing files
2. Reading the modified files back to confirm correctness
3. If a fix fails, try a different approach — never repeat the same edit

## How to Edit Code

1. **Always \`read_file\` before \`update\`.** The \`oldString\` must match exactly — including whitespace and indentation.
2. **Use \`update\` for existing files** — it replaces only the targeted text and preserves everything else.
3. **Use \`write\` for new files** or when replacing an entire file.
4. **Include enough surrounding context** in \`oldString\` to make it unique in the file.
5. **After editing, check downstream** — use \`search_pattern\` or \`dependents\` to verify nothing is broken.

## Git Workflow — MANDATORY

You MUST follow these rules. Skipping git commits is a critical error.

- **Every completed todo gets a commit.** After marking a todo \`completed\`, you MUST run \`git add -A && git commit -m "type: description"\`. No exceptions.
- **Commit messages**: Use conventional commit format — \`feat:\`, \`fix:\`, \`refactor:\`, \`chore:\`, \`docs:\`
- **You are already in the project root.** Do NOT prefix commands with \`cd\`. Just run: \`git add -A && git commit -m "feat: add user model"\`
- **Never force push, reset --hard, or delete main/master branches**
- **Stay on the feature branch.** Do NOT merge to main unless the user explicitly says "merge", "ship it", or "looks good".
- **If \`git add -A\` stages nothing** (no changes to commit), skip the commit and continue — this means the todo was already committed or no files changed.

## How to Investigate

1. Use tools to gather facts before answering. For complex questions, break them into steps and call tools in sequence.
2. When exploring unfamiliar code, start with \`context_manifest\` → \`context_folder\` for a quick overview, then drill into specific symbols with \`search\` → \`context\`.
3. Always verify claims against actual source code using \`search_pattern\`. The indexed data can have gaps — especially for re-exports, dynamic imports, and CommonJS patterns.
4. When answering "is X used?", "who imports X?", or "is X unused?" — ALWAYS run \`search_pattern\` to confirm, even if the graph shows an answer.

## Limitations

- The dependency graph only indexes JavaScript (.js, .jsx, .mjs, .cjs), TypeScript (.ts, .tsx), and Python (.py) files. For any other language, use \`read_file\`, \`search_pattern\`, and \`search_web\` instead of graph tools.
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

${skillContent ? `\n## Skills\n\n${skillContent}\n` : ''}${contextSection ? `\n## Current Context\n\nThe user is viewing the codebase in their browser. Here is the context from their current view:\n\n${contextSection}\n` : ''}`
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

function formatContext(context: Record<string, unknown>): string {
  const parts: string[] = []

  // Graph overview
  const overview = context.graphOverview as { nodeCount?: number; edgeCount?: number; nodeKinds?: Record<string, number>; edgeTypes?: Record<string, number> } | undefined
  if (overview) {
    parts.push('**Graph overview:**')
    parts.push(`- ${overview.nodeCount ?? 0} nodes, ${overview.edgeCount ?? 0} edges`)
    if (overview.nodeKinds && Object.keys(overview.nodeKinds).length > 0) {
      const kinds = Object.entries(overview.nodeKinds).map(([k, v]) => `${k}: ${v}`).join(', ')
      parts.push(`- Node types: ${kinds}`)
    }
    if (overview.edgeTypes && Object.keys(overview.edgeTypes).length > 0) {
      const types = Object.entries(overview.edgeTypes).map(([k, v]) => `${k}: ${v}`).join(', ')
      parts.push(`- Edge types: ${types}`)
    }
  }

  // Selected node
  const sel = context.selectedNode as { id?: string; name?: string; kind?: string; filePath?: string; range?: { startLine: number; endLine: number } } | null | undefined
  if (sel && sel.id) {
    parts.push('')
    parts.push('**Selected node:**')
    parts.push(`- ${sel.name} (${sel.kind}) in ${sel.filePath}`)
    if (sel.range) parts.push(`- Lines ${sel.range.startLine}-${sel.range.endLine}`)
    parts.push(`- Node ID: ${sel.id}`)
  }

  // Selected node context (relationships)
  const selCtx = context.selectedNodeContext as { incoming?: Array<{ name: string; kind: string; edgeType: string; filePath: string }>; outgoing?: Array<{ name: string; kind: string; edgeType: string; filePath: string }>; members?: Array<{ name: string; kind: string }>; hierarchy?: Array<{ name: string; kind: string; relation: string }> } | null | undefined
  if (selCtx) {
    if (selCtx.incoming && selCtx.incoming.length > 0) {
      parts.push('')
      parts.push('**Incoming references to selected node:**')
      for (const ref of selCtx.incoming.slice(0, 10)) {
        parts.push(`  - ${ref.name} (${ref.kind}) via ${ref.edgeType} — ${ref.filePath}`)
      }
      if (selCtx.incoming.length > 10) parts.push(`  - ... and ${selCtx.incoming.length - 10} more`)
    }
    if (selCtx.outgoing && selCtx.outgoing.length > 0) {
      parts.push('')
      parts.push('**Outgoing references from selected node:**')
      for (const ref of selCtx.outgoing.slice(0, 10)) {
        parts.push(`  - ${ref.name} (${ref.kind}) via ${ref.edgeType} — ${ref.filePath}`)
      }
      if (selCtx.outgoing.length > 10) parts.push(`  - ... and ${selCtx.outgoing.length - 10} more`)
    }
    if (selCtx.members && selCtx.members.length > 0) {
      parts.push('')
      parts.push('**Members of selected node:**')
      for (const m of selCtx.members.slice(0, 15)) {
        parts.push(`  - ${m.name} (${m.kind})`)
      }
      if (selCtx.members.length > 15) parts.push(`  - ... and ${selCtx.members.length - 15} more`)
    }
    if (selCtx.hierarchy && selCtx.hierarchy.length > 0) {
      parts.push('')
      parts.push('**Type hierarchy:**')
      for (const h of selCtx.hierarchy) {
        parts.push(`  - ${h.name} (${h.kind}) — ${h.relation}`)
      }
    }
  }

  return parts.join('\n')
}

// ── Tool definitions ───────────────────────────────────────────────────────

function defineAgentTools(qs: AuraQueryService, projectPath: string): AgentTool[] {
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
          const exists = await fs.access(fullPath).then(() => true).catch(() => false)
          await fs.mkdir(path.dirname(fullPath), { recursive: true })
          await fs.writeFile(fullPath, content, 'utf-8')

          const linesWritten = content.split('\n').length
          return {
            filePath,
            linesWritten,
            created: !exists,
            applied: true,
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

          if (!content.includes(oldString)) {
            return {
              error: `oldString not found in "${filePath}". Use read_file to see the exact content and try again.`,
              hint: 'Make sure the string matches exactly, including whitespace, indentation, and line breaks.',
            }
          }

          if (!replaceAll) {
            const firstIndex = content.indexOf(oldString)
            const secondIndex = content.indexOf(oldString, firstIndex + 1)
            if (secondIndex !== -1) {
              return {
                error: `oldString appears ${content.split(oldString).length - 1} times in "${filePath}". Provide more surrounding context to make it unique, or set replaceAll to true.`,
              }
            }
          }

          const newContent = replaceAll
            ? content.replaceAll(oldString, newString)
            : content.replace(oldString, newString)

          const replacements = replaceAll
            ? content.split(oldString).length - 1
            : 1

          await fs.writeFile(fullPath, newContent, 'utf-8')

          return {
            filePath,
            replacements,
            applied: true,
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
      description: 'Run a shell command in the project directory. You are already in the project root — do NOT prefix commands with `cd`. Just run the command directly (e.g. `npm run build`, not `cd /path && npm run build`). Use this to test fixes, check git status, install packages, or verify changes. Returns stdout, stderr, and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run, e.g. "npm run build", "npx tsc --noEmit", "git diff", "npm test"' },
          timeout: { type: 'number', description: 'Timeout in seconds (default: 30, max: 120)' },
        },
        required: ['command'],
      },
      execute: async (args) => {
        const command = args.command as string
        const timeoutSeconds = Math.min(120, (args.timeout as number | undefined) ?? 30)
        const timeoutMs = timeoutSeconds * 1000

        // Block dangerous commands outright
        for (const pattern of BLOCKED_COMMAND_PATTERNS) {
          if (pattern.test(command)) {
            return { error: `Command blocked for safety: "${command}". This pattern matches a potentially destructive operation.` }
          }
        }

        // NOTE: Commands matching NEEDS_APPROVAL_PATTERNS are checked in the agent loop
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

    // ── Web Research Tools ─────────────────────────────────────────────────

    {
      name: 'search_web',
      description: 'Fetch and render web page content with full JavaScript rendering via crawl4ai. ALWAYS use "url" when a specific URL is available — it returns the full rendered page. Use "query" ONLY when you need to discover pages about a topic you don\'t have a URL for. Use "design: true" to extract a website\'s visual design tokens (colors, fonts, spacing, etc.) instead of reading its content. Use "flags" for advanced behavior like deep crawling, stealth mode, or targeting specific page sections.',
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
        const design = args.design === true
        const query = String(args.query ?? '')
        const url = String(args.url ?? '')
        const flags = (args.flags ?? {}) as Record<string, unknown>

        if (design && !url) {
          return { error: 'The "design" flag requires a URL. Design extraction cannot be performed on search results.' }
        }

        const targetUrl = url || `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`

        if (!url && !query) {
          return { error: 'Either query or url is required for search_web' }
        }

        let configDir: string | null = null
        try {
          let cliArgs: string[]
          if (design) {
            const result = buildDesignCrawlArgs(targetUrl, flags)
            cliArgs = result.args
            configDir = result.configDir
          } else {
            cliArgs = buildCrawlArgs(targetUrl, flags)
          }

          const timeout = flags.deep_crawl ? 120000 : 30000
          const maxBuffer = flags.deep_crawl ? 5 * 1024 * 1024 : 1024 * 1024

          const { stdout } = await execFileAsync('crwl', cliArgs, { timeout, maxBuffer })
          let content = stdout.trim()
          return { source: targetUrl, content: content || `No content returned from ${targetUrl}` }
        } catch {
          if (design) {
            return { error: 'Design extraction requires crawl4ai (crwl CLI). Ensure crawl4ai is installed and the URL is accessible.' }
          }
          try {
            const response = await fetch(targetUrl, {
              signal: AbortSignal.timeout(10000),
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
              },
            })
            if (!response.ok) {
              return { error: `HTTP ${response.status} ${response.statusText} for ${targetUrl}` }
            }
            const text = await response.text()
            return { source: targetUrl, content: text }
          } catch (fetchErr) {
            return { error: `Failed to fetch ${targetUrl}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}` }
          }
        } finally {
          if (configDir) {
            try { rmSync(configDir, { recursive: true, force: true }) } catch {}
          }
        }
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
      description: 'Dispatch 2 or more parallel agents. Each agent runs its own tool-calling loop and returns a text summary. Choose the right type for each task: "explore" for investigating code, "research" for web/docs lookup, "fix" for making and verifying edits, "plan" for creating implementation plans. ONLY use this when the question requires investigating 2+ independent areas in parallel. For single-focus questions, call tools directly.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'What to investigate or do — a focused question for the agent' },
                focus: { type: 'string', description: 'Specific focus area — e.g., "upstream dependencies", "API surface", "auth module"' },
                type: { type: 'string', enum: ['explore', 'research', 'fix', 'plan'], description: 'Agent type: "explore" (investigate code, read-only), "research" (web/docs), "fix" (make and verify edits), "plan" (create implementation plan, read-only)' },
              },
              required: ['task'],
            },
            description: 'Array of 2+ tasks for parallel agents',
          },
        },
        required: ['tasks'],
      },
      execute: async () => {
        return { error: 'dispatch_sub_agents should not be called directly' }
      },
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

  constructor(qs: AuraQueryService, projectPath: string, ollamaBaseUrl?: string, model?: string, contextWindow?: number) {
    this.qs = qs
    this.projectPath = projectPath
    this.ollamaBaseUrl = ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    this.model = model || process.env.OLLAMA_MODEL || 'glm-5.1:cloud'
    this.contextWindow = contextWindow ?? 200_000
    // Get or create the ApprovalManager for this project
    let am = globalApprovalManagers.get(projectPath)
    if (!am) {
      am = new ApprovalManager()
      globalApprovalManagers.set(projectPath, am)
    }
    this.approvalManager = am
  }

  static estimateSystemTokens(qs: AuraQueryService, projectPath: string, ollamaBaseUrl: string, model: string): number {
    const systemPrompt = buildSystemPrompt('', undefined, undefined, undefined)
    return estimateTokens(systemPrompt)
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  async run(prompt: string, eventSink: AgentEventSink, context?: Record<string, unknown>, priorMessages?: Array<{ role: string; content: string }>): Promise<void> {
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

    // If greenfield and no git repo, initialize git (but don't make initial commit — the LLM will create .gitignore first)
    if (isGreenfield) {
      try {
        await execFileAsync('git', ['--version'])
        try {
          await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: this.projectPath })
        } catch {
          await execFileAsync('git', ['init'], { cwd: this.projectPath })
          // Create a placeholder initial commit so branching works
          // The LLM will create .gitignore as its first action and commit it
          const gitignorePlaceholder = path.join(this.projectPath, '.gitignore')
          await fs.writeFile(gitignorePlaceholder, '# Placeholder — will be replaced by LLM-generated .gitignore\n', 'utf-8')
          await execFileAsync('git', ['add', '.gitignore'], { cwd: this.projectPath })
          await execFileAsync('git', ['commit', '-m', 'chore: initial commit (placeholder .gitignore)'], { cwd: this.projectPath })
          gitContext = 'Initialized a new git repository. IMPORTANT: Your FIRST action must be to overwrite .gitignore with a proper .gitignore for this project type (e.g., Node.js, Python, Rust, etc.), then commit it.\n'
          currentBranch = 'main'
        }
      } catch { /* git not available */ }
    }

    // ── Plan resumption & branch logic ─────────────────────────────────────────
    // Order matters: load plan FIRST, then decide whether to create or checkout a branch.
    const planService = new PlanPersistenceService()
    let planResume: PlanResumeContext | null = null
    let activePlan: SavedPlan | null = null
    const isBuildTask = skills.includes('aura-building')

    // Clean up stale plan files (branches that no longer exist)
    try {
      const { stdout: branchList } = await execFileAsync('git', ['branch', '--list', 'aura/*'], { cwd: this.projectPath })
      const existingBranches = branchList.trim().split('\n').map(b => b.trim()).filter(Boolean)
      await planService.cleanupStalePlans(this.projectPath, existingBranches)
    } catch { /* best-effort cleanup */ }

    // Try to load an existing active plan (finds by branch, then falls back to ANY plan with pending todos)
    try {
      activePlan = await planService.loadActivePlan(this.projectPath, currentBranch)
    } catch { /* plan resume is best-effort */ }

    // Determine the slug and branch strategy
    let slug: string
    if (activePlan) {
      // Resuming an existing plan — use its slug and branch
      slug = activePlan.slug
      const pendingTodos = activePlan.todos.filter(t => t.status !== 'completed')
      if (pendingTodos.length > 0) {
        planResume = {
          slug: activePlan.slug,
          originalPrompt: activePlan.originalPrompt,
          todos: activePlan.todos,
          nextTask: pendingTodos[0].subject,
        }
        // If we're on main/master, checkout the plan's existing branch
        if (currentBranch === 'main' || currentBranch === 'master') {
          const targetBranch = activePlan.branchName
          try {
            // Check if the branch already exists
            const { stdout: branches } = await execFileAsync('git', ['branch', '--list', targetBranch], { cwd: this.projectPath })
            if (branches.trim()) {
              // Branch exists — checkout it
              await execFileAsync('git', ['checkout', targetBranch], { cwd: this.projectPath })
            } else {
              // Branch doesn't exist — create it
              await execFileAsync('git', ['checkout', '-b', targetBranch], { cwd: this.projectPath })
            }
            currentBranch = targetBranch
            gitContext += `Resuming on branch: ${targetBranch}\n`
          } catch { /* branch checkout failed, continue on current branch */ }
        }
      } else {
        // All todos completed but plan file still exists — clean up
        await planService.deletePlan(this.projectPath, activePlan.slug)
        activePlan = null
      }
    } else {
      // No active plan — derive slug from prompt for new plan
      slug = prompt.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    }

    // Auto-branch for build tasks (only when no plan was resumed and still on main/master)
    if (!activePlan && isBuildTask && currentBranch && (currentBranch === 'main' || currentBranch === 'master')) {
      try {
        const branchName = `aura/${slug}`
        await execFileAsync('git', ['checkout', '-b', branchName], { cwd: this.projectPath })
        currentBranch = branchName
        gitContext += `Created feature branch: ${branchName}\n`
      } catch { /* branch creation failed, continue anyway */ }
    }

    const systemPrompt = buildSystemPrompt(skillContent, contextSection, isGreenfield || undefined, gitContext || undefined, planResume || undefined)

    // Build tools
    const tools = defineAgentTools(this.qs, this.projectPath)
    const ollamaTools = buildOllamaTools(tools)

    const priorMsgs = priorMessages || []

    // Emit context usage so the UI can show a progress bar
    const systemTokens = estimateTokens(systemPrompt)
    const promptTokens = estimateTokens(prompt)
    const priorTokens = estimateMessagesTokens(priorMsgs)
    eventSink.emit('context_usage', {
      systemTokens,
      messageTokens: priorTokens,
      promptTokens,
      contextWindow: this.contextWindow,
    })

    // Build messages: system + prior conversation + current prompt
    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    for (const m of priorMsgs) {
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content })
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

    // Agent loop
    const maxIterations = 500
    const recentToolCalls: string[] = []  // Track tool call signatures for deduplication
    let todoList: AuraTodoItem[] = planResume ? [...planResume.todos] : []
    let previousTodoList: AuraTodoItem[] = []
    for (let i = 0; i < maxIterations; i++) {
      if (this.abortController.signal.aborted) {
        eventSink.emit('done', {})
        return
      }

      // Compact messages if context is getting too large
      const compacted = compactMessages(messages, systemPrompt, todoList, this.contextWindow, planResume)
      if (compacted !== messages) {
        messages.length = 0
        messages.push(...compacted)
      }

      const result = await this.streamChat(messages, ollamaTools, eventSink)

      if (!result) {
        eventSink.emit('done', {})
        return
      }

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
        const subResults = await this.runSubAgents(tasks, systemPrompt, ollamaTools, eventSink)

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
        previousTodoList = todoList
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

        // If a todo was just marked completed, nudge the model to commit
        const newlyCompleted = todoList.filter(
          (t, idx) => t.status === 'completed' && previousTodoList[idx]?.status !== 'completed',
        )
        if (newlyCompleted.length > 0) {
          const subjects = newlyCompleted.map(t => t.subject).join(', ')
          messages.push({
            role: 'user',
            content: `Todo completed: "${subjects}". You MUST commit this now. Run: git add -A && git commit -m "feat: ${subjects.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}"`,
          })
        }
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
          tool_call_id: askCall.id || `ask_user_${i}`,
          name: 'ask_user',
        })
        result.toolCalls = result.toolCalls.filter(tc => tc.name !== 'ask_user')
      }

      // Execute regular tool calls
      let hasFileEdits = false
      for (const tc of result.toolCalls) {
        if (tc.name === 'dispatch_sub_agents') continue
        if (tc.name === 'todo_write') continue

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
          for (const pattern of NEEDS_APPROVAL_PATTERNS) {
            if (pattern.test(command)) {
              const approvalId = `exec_${Date.now()}_${i}`
              const approval = await this.approvalManager.requestApproval(
                approvalId,
                eventSink,
                'command',
                { command, cwd: this.projectPath },
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
        eventSink.emit('error', { message: `Ollama chat failed: ${response.status} ${errText}` })
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
      eventSink.emit('error', { message: `Ollama request failed: ${(err as Error).message}` })
      return null
    }
  }

  private async runSubAgents(
    tasks: SubAgentTask[],
    systemPrompt: string,
    ollamaTools: OllamaTool[],
    eventSink: AgentEventSink,
  ): Promise<Array<{ focus: string; result: string }>> {
    const allTools = defineAgentTools(this.qs, this.projectPath)
    const maxSubIterations = 15

    const runOne = async (task: SubAgentTask): Promise<string> => {
      const agentType: SubAgentType = task.type || 'explore'
      eventSink.emit('sub_agent_start', { taskId: task.focus, task: task.task, type: agentType })

      // Build specialized system prompt for this agent type
      const agentPrompt = SUB_AGENT_SYSTEM_PROMPTS[agentType]
      const fullSystemPrompt = `${systemPrompt}\n\n${agentPrompt}\n\nFocus on: ${task.focus}`

      // Filter tools based on agent type
      const allowedTools = TOOL_ACCESS[agentType]
      const filteredTools = allTools.filter(t => allowedTools.includes(t.name))
      const filteredOllamaTools = buildOllamaTools(filteredTools)

      const messages: OllamaMessage[] = [
        { role: 'system', content: fullSystemPrompt },
        { role: 'user', content: task.task },
      ]

      let lastContent = ''
      for (let i = 0; i < maxSubIterations; i++) {
        const subSink = new SilentEventSink()
        const result = await this.streamChat(messages, filteredOllamaTools, subSink)
        if (result?.content) lastContent = result.content

        if (!result || result.toolCalls.length === 0) {
          eventSink.emit('sub_agent_result', { taskId: task.focus, result: result?.content || 'No findings' })
          return result?.content || 'No findings'
        }

        // On the last iteration, return whatever content the model produced alongside tool calls
        if (i === maxSubIterations - 1) {
          const summary = lastContent || 'Sub-agent ran out of iterations before producing a final summary'
          eventSink.emit('sub_agent_result', { taskId: task.focus, result: summary })
          return summary
        }

        messages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.args } })),
        })

        for (const tc of result.toolCalls) {
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
      eventSink.emit('sub_agent_result', { taskId: task.focus, result: lastContent || 'No findings' })
      return lastContent || 'No findings'
    }

    // Run sub-agents in parallel
    const results = await Promise.allSettled(
      tasks.map(task => runOne(task)),
    )

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