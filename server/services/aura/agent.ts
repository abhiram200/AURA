import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'
import type { Response } from 'express'
import type { AuraQueryService } from './graph.ts'
import type { AgentEventSink } from './sse.ts'
import { SilentEventSink } from './sse.ts'

// ── AURA-specific compaction prompt ──────────────────────────────────────────

const AURA_COMPACTION_PROMPT = `You are summarizing a conversation between a user and AURA, a code intelligence assistant connected to the user's codebase. Your job is to produce a detailed, structured markdown summary that captures everything needed to continue the conversation seamlessly — as if the summary IS the conversation from the assistant's perspective.

## What to preserve (be exhaustive)

- **User's intent**: What exactly are they trying to accomplish? Not vague — the specific goal.
- **Current progress**: What has been completed, what's in progress, what's next.
- **Findings from tools**: Every concrete fact discovered — file paths, symbol names, function signatures, dependency relationships, import/export chains, route mappings, architecture insights. These are the most important outputs and must be preserved in detail.
- **Decisions made**: Technical choices, approaches selected, trade-offs discussed, conclusions reached.
- **Code references**: Exact file paths, line numbers, symbol names, function/class/interface names that were discussed or investigated.
- **User preferences**: Anything the user stated about how they want things done — coding style, preferred libraries, naming conventions, architectural preferences.
- **Errors encountered**: Error messages, stack traces, or failure modes that were discussed and their resolutions (if any).
- **Unresolved questions**: Open issues, unanswered questions, things the user wanted to investigate further.

## What to strip

- **Tool call payloads**: Remove the raw arguments sent to tools (large JSON objects, search queries, etc.). Replace with a one-line description of what the tool was asked to do.
- **Tool result bodies**: Remove large result payloads (full file contents, long JSON responses, graph data dumps). Extract ONLY the key findings, facts, and conclusions from each result.
- **Repetitive exchanges**: If the user asked the same thing multiple ways or the assistant retried the same approach, keep only the final successful attempt.
- **Greeting/pleasantries**: Remove entirely.
- **Streaming artifacts**: Remove partial responses, empty content, or cursor markers.

## Output format

Produce a markdown document with these sections:

### Intent
One clear sentence: what is the user trying to accomplish?

### Progress
- What has been completed
- What is currently in progress (if anything)
- What remains to be done

### Key Findings
The most important section. List every concrete fact, discovery, or insight from tool usage. Be specific:
- File paths with relevant details (e.g., "src/auth.ts:login — handles JWT validation, called by authMiddleware")
- Symbol relationships (e.g., "UserModel → depends on → DatabaseConnection, EmailService")
- Architecture notes (e.g., "Routes are defined in src/routes/ using Express Router, middleware in src/middleware/")
- Any numbers, sizes, counts mentioned

### Decisions
- Each decision or conclusion reached, with context on why

### Code References
- Specific files, symbols, line ranges that were discussed or investigated

### User Preferences
- Any stated preferences about approach, style, or methodology

### Unresolved
- Open questions or incomplete tasks

## Rules
- Be specific, not generic. "src/auth.ts exports validateToken which checks JWT expiry" not "auth was discussed"
- Include exact names — function names, variable names, file paths, class names
- Preserve the narrative: what was discovered in what order matters for continuity
- If the conversation was about debugging, preserve the diagnosis and root cause
- If code changes were discussed, preserve what was changed and why
- Do NOT include any raw tool inputs/outputs — only their key takeaways
- The summary should be detailed enough that a fresh agent can pick up exactly where the conversation left off without missing any technical context

Conversation to summarize:`

// ── Token estimation ────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_WINDOW = 200_000

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
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
}

// ── Intent detection ───────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ keywords: string[]; skill: string }> = [
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

function buildSystemPrompt(skillContent: string, contextSection?: string): string {
  return `You are AURA (Artificial Unified Responsive Assistant) — a code intelligence agent connected to the user's codebase. Use your tools to investigate and answer questions accurately — do not guess or make up information.

When answering:
1. Use tools to gather facts before answering
2. For complex questions, break them into steps and use the appropriate tools in sequence
3. Only use dispatch_sub_agents when it genuinely speeds up the answer — i.e., when the question requires gathering independent information from two or more distinct areas that can be researched in parallel (e.g., "How do the frontend components interact with the backend API?" where frontend and backend can be explored simultaneously). Do NOT use sub-agents for single-aspect questions or when sequential tool calls are sufficient — just call the tools directly yourself.
4. Always cite specific symbols, files, and relationships you found
5. If you cannot find information with the available tools, say so clearly
6. If the user has a node selected in the Aura graph (shown under "Current Context" below), acknowledge it at the start of your response. For example: "I can see you're looking at \`src/auth.ts:login\` —" or "Looking at the \`UserModel\` class you've selected —". This helps the user know you're aware of what they're examining.

IMPORTANT — Graph service language limitations:
The dependency graph only indexes JavaScript (.js, .jsx, .mjs, .cjs), TypeScript (.ts, .tsx), and Python (.py) files. For any other language (Go, Rust, Java, C/C++, C#, Ruby, PHP, Swift, Kotlin, etc.), the graph has NO indexed data — no nodes, no edges, no symbols. When analyzing code in unsupported languages:
- Do NOT use graph tools for those files — they will return empty or misleading results.
- Instead, use all other available tools (read_file, search_pattern, etc.) and your own code analysis capabilities.
- State clearly: "The dependency graph doesn't index [language] files, so it might take longer time and (or) be token intensive."

IMPORTANT — Always verify claims against the actual source code:
- The indexed data CAN and DOES have gaps. It may list incorrect or missing import relationships, especially for re-exports, dynamic imports, or CommonJS patterns.
- When answering "is X used?", "who imports X?", "is X imported by Y?", or "is X unused?" — ALWAYS run search_pattern to find actual import/usage statements in the codebase before giving your answer. Do this EVERY TIME, even if the indexed data already shows an answer.
- If search_pattern finds no imports of an exported symbol, state clearly that it appears to be unused, even if the indexed data claims otherwise.
- If search_pattern finds imports that the indexed data missed, include those in your answer.
- Never state "X is used by Y" or "X is imported by Y" unless you have confirmed it by searching the actual source files.

IMPORTANT — Response style:
- Never mention tools, tool calls, or tool results in your response. Speak as if you personally investigated the codebase and found the information.
- Do NOT say things like "the search tool returned" or "I used the context tool" or "according to the data from the tool". Instead, say "I searched the codebase and found" or "Looking at the source code".
- Do NOT mention "graph", "dependency graph", "knowledge graph", or similar terms. You are connected to the codebase, not a graph. Say "the codebase", "the project", or "the code" instead.
- Your response should read as a knowledgeable engineer explaining what they found, not a report about tool usage.

Formatting rules for your final response:
- Use markdown: headings (##), bold (**text**), bullet lists, numbered lists
- Use inline code for symbol names and file paths (e.g. \`src/auth.ts:login\`)
- Use fenced code blocks with language tags for code snippets
- Structure your answer with clear sections — don't dump unformatted text
- Be concise but complete. Prefer specific facts over vague summaries

Node ID format: filePath:symbolName (e.g., "src/auth.ts:login"), or just filePath for File nodes, or filePath:METHOD /path for Route nodes.

${contextSection ? `\n## Current Context\n\nThe user is viewing the codebase in their browser. Here is the context from their current view:\n\n${contextSection}\n` : ''}${skillContent}`
}

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
      description: 'Get a 360-degree view of a symbol. Returns the node itself, incoming references (who calls/imports it), outgoing references (what it calls/imports), members (for classes/interfaces), containment info (which file/class contains it), and hierarchy (extends/implements relationships). Use this after search to understand a symbol\'s role and relationships. Each reference includes the edge type (CALLS, IMPORTS, EXTENDS, etc.).',
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

    {
      name: 'route_map',
      description: 'Get all HTTP route registrations in the project. Returns Route nodes, ApiCall nodes, and HANDLES/FETCHES/MIDDLEWARE edges. Use this to understand the API surface of the project — what endpoints exist, what handlers serve them, and what external APIs they call.',
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
      description: 'Get all MCP tool definitions in the project. Returns MCP tool Route nodes and their HANDLES edges. Use this to discover MCP tool endpoints defined in the codebase.',
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
      description: 'Compare a route\'s response shape against how consumers actually access it. Returns mismatches where consumers use fields not present in the response. Use this before modifying API response structures to catch potential breakage.',
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
      description: 'Comprehensive risk report for an API route. Returns consumers, response shape vs consumer mismatches, middleware, downstream impact, and overall risk level (low/medium/high/critical). Use this for API change planning.',
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
      description: 'List all detected execution flows (process traces) in the project. Each process represents an HTTP request lifecycle from route entry through middleware, handler, and service calls. Returns process ID, name, HTTP method, path, and step count.',
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
      description: 'Get detailed steps of a specific execution flow (process trace). Returns ordered steps with node IDs, names, kinds, and step labels (entry/middleware/handler/service/call). Use this to trace how a request flows through the codebase.',
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
      description: 'Get AI-generated context for a specific folder. Returns a markdown document describing the folder\'s architectural role, key exports, dependencies, and types. Use this to understand a specific part of the codebase.',
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
        // Truncate if very large
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

    {
      name: 'detect_changes',
      description: 'Analyze git diff to find changed symbols and their blast radius. Returns changed files, changed symbols with line ranges, and merged impact analysis. Requires the project to be a git repository. Use this to assess the impact of uncommitted or recent changes.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Git diff scope: "unstaged" (default), "staged", "all", or "compare"', enum: ['unstaged', 'staged', 'all', 'compare'] },
          base: { type: 'string', description: 'Base commit for "compare" scope' },
          head: { type: 'string', description: 'Head commit for "compare" scope' },
        },
      },
      execute: async (args) => {
        // This tool needs special handling — it requires git diff processing
        // The agent route handler will intercept this and call the proper endpoint logic
        // For now, return a hint that this needs the project path
        return { note: 'detect_changes requires project path context. Use the project path from the agent context.' }
      },
    },

    {
      name: 'rename',
      description: 'Rename a symbol across the codebase. Uses graph traversal (high confidence) and text search (lower confidence) to find all references. Always dry-run first to preview changes. Returns edits with file paths, old/new text, and confidence levels. Set dryRun to false to apply changes.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Node ID of the symbol to rename. If just a name, will search for it.' },
          newName: { type: 'string', description: 'New name for the symbol' },
          dryRun: { type: 'boolean', description: 'Preview changes without applying (default: true)', default: true },
        },
        required: ['nodeId', 'newName'],
      },
      execute: async (args) => {
        let resolvedId = args.nodeId as string
        const newName = args.newName as string
        const dryRun = args.dryRun !== false
        // If nodeId doesn't contain ':', search for it
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
        return await qs.rename(resolvedId, newName, dryRun)
      },
    },

    {
      name: 'read_file',
      description: 'Read the full contents of a source file. Returns the file with line numbers. Use this when you need to see the complete implementation of a file. For large files, use startLine/endLine to read a specific range. Prefer search_pattern when you only need the area around a specific function or pattern.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'File path relative to project root, e.g. "src/auth.ts" or "server/services/graph.ts"' },
          startLine: { type: 'number', description: 'Line number to start reading from (1-based). Omit to read from the beginning.' },
          endLine: { type: 'number', description: 'Line number to stop reading at (inclusive). Omit to read to the end.' },
        },
        required: ['filePath'],
      },
      execute: async (args) => {
        const filePath = args.filePath as string
        const startLine = args.startLine as number | undefined
        const endLine = args.endLine as number | undefined
        const fullPath = path.resolve(projectPath, filePath)

        if (!fullPath.startsWith(path.resolve(projectPath))) {
          return { error: 'Invalid file path' }
        }

        try {
          const content = await fs.readFile(fullPath, 'utf-8')
          const lines = content.split('\n')
          const start = Math.max(1, startLine ?? 1)
          const end = Math.min(lines.length, endLine ?? lines.length)

          if (start > lines.length) {
            return { error: `File has ${lines.length} lines. startLine ${start} is out of range.` }
          }

          const MAX_LINES = 500
          const cappedEnd = Math.min(end, start + MAX_LINES - 1)
          const truncated = end > cappedEnd

          const selected = lines.slice(start - 1, cappedEnd)
          const numbered = selected.map((line, i) => `${start + i}: ${line}`).join('\n')

          return {
            filePath,
            totalLines: lines.length,
            startLine: start,
            endLine: cappedEnd,
            ...(truncated ? { note: `Showing ${MAX_LINES} of ${end - start + 1} requested lines. Use startLine/endLine to read more.` } : {}),
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
              // Skip node_modules, .git, dist, build, coverage
              if (entry.isDirectory() && ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache'].includes(entry.name)) continue
              const entryFullPath = path.join(dir, entry.name)
              if (entry.isDirectory()) {
                await searchDir(entryFullPath, entryRelPath)
              } else {
                // Apply glob filter
                if (glob) {
                  const ext = entry.name.includes('.') ? '*.' + entry.name.split('.').pop() : entry.name
                  const fileGlob = `**/${ext}`
                  // Simple glob matching: check extension and path pattern
                  if (!matchesGlob(entryRelPath, glob) && !matchesGlob(entry.name, glob)) continue
                }
                // Skip binary/non-text files
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
      name: 'dispatch_sub_agents',
      description: 'Dispatch 2 or more parallel research sub-agents. Each sub-agent runs its own tool-calling loop and returns a text summary. ONLY use this when the question requires investigating two or more genuinely independent areas that can be researched simultaneously — e.g., exploring frontend components AND backend API endpoints in parallel. For single-focus questions or sequential lookups, call tools directly instead — sub-agents add latency and overhead for simple queries and should not be used just to "look something up."',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'What to investigate — a focused question for the sub-agent' },
                focus: { type: 'string', description: 'Specific focus area — e.g., "upstream dependencies", "API surface"' },
              },
              required: ['task'],
            },
            description: 'Array of 2+ research tasks for parallel sub-agents',
          },
        },
        required: ['tasks'],
      },
      execute: async () => {
        // This is handled specially by the agent loop — it should never be called directly
        return { error: 'dispatch_sub_agents should not be called directly' }
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

// ── Agent class ────────────────────────────────────────────────────────────

export class AuraAgent {
  private qs: AuraQueryService
  private projectPath: string
  private ollamaBaseUrl: string
  private model: string
  private contextWindow: number
  private abortController: AbortController | null = null

  constructor(qs: AuraQueryService, projectPath: string, ollamaBaseUrl?: string, model?: string, contextWindow?: number) {
    this.qs = qs
    this.projectPath = projectPath
    this.ollamaBaseUrl = ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    this.model = model || process.env.OLLAMA_MODEL || 'glm-5.1:cloud'
    this.contextWindow = contextWindow ?? 200_000
  }

  static estimateSystemTokens(qs: AuraQueryService, projectPath: string, ollamaBaseUrl: string, model: string): number {
    const tools = defineAgentTools(qs, projectPath)
    const ollamaTools = buildOllamaTools(tools)
    const systemPrompt = buildSystemPrompt('')
    return estimateTokens(systemPrompt) + estimateTokens(JSON.stringify(ollamaTools))
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  private async compactPriorMessages(
    priorMessages: Array<{ role: string; content: string }>,
    eventSink: AgentEventSink,
  ): Promise<{ compacted: Array<{ role: string; content: string }>; kept: Array<{ role: string; content: string }> }> {
    // Exclude last 2 messages (1 user+assistant exchange) from compaction
    const toCompact = priorMessages.slice(0, -2)
    const kept = priorMessages.slice(-2)

    const conversationText = toCompact
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n---\n\n')

    const result = await this.streamChat(
      [
        { role: 'system', content: 'You are a conversation summarizer for AURA, a code intelligence assistant. Produce a detailed, structured markdown summary following the exact format specified in the instructions. Preserve all technical details — file paths, symbol names, relationships, and findings. Strip all tool inputs/outputs to their key takeaways only.' },
        { role: 'user', content: `${AURA_COMPACTION_PROMPT}\n\n${conversationText}` },
      ],
      [],
      new SilentEventSink(),
    )

    const summary = result?.content || 'Previous conversation context was summarized due to length. Key findings are preserved.'

    // Build compacted messages: a summary pair that gives the agent context
    const compacted: Array<{ role: string; content: string }> = [
      { role: 'user', content: `[Earlier Conversation Summary]\n\n${summary}` },
      { role: 'assistant', content: 'Understood. I have the full context from our previous conversation and am ready to continue.' },
    ]

    // Emit compacted event with replacement messages for the client
    // Include the kept messages so the client can replace the full history
    const clientMessages = [
      ...compacted.map(m => ({
        id: crypto.randomUUID(),
        role: m.role,
        content: m.content,
        timestamp: Date.now(),
      })),
      ...kept.map(m => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: Date.now(),
      })),
    ]

    eventSink.emit('compacted', { messages: clientMessages })

    return { compacted, kept }
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
    const systemPrompt = buildSystemPrompt(skillContent, contextSection)

    // Build tools
    const tools = defineAgentTools(this.qs, this.projectPath)
    const ollamaTools = buildOllamaTools(tools)

    // Check if context compaction is needed
    // Reserve 20% of context window for the model's response generation
    const contextLimit = this.contextWindow
    const compactionThreshold = Math.floor(contextLimit * 0.8)
    let effectivePriorMessages = priorMessages || []

    const systemTokens = estimateTokens(systemPrompt)
    const promptTokens = estimateTokens(prompt)
    const priorTokens = estimateMessagesTokens(effectivePriorMessages)
    const totalEstimated = systemTokens + promptTokens + priorTokens

    if (totalEstimated > compactionThreshold && effectivePriorMessages.length > 2) {
      eventSink.emit('compacting', {})
      const { compacted, kept } = await this.compactPriorMessages(effectivePriorMessages, eventSink)
      effectivePriorMessages = [...compacted, ...kept]
    }

    // Emit context usage so the UI can show a progress bar
    const toolsTokens = estimateTokens(JSON.stringify(ollamaTools))
    eventSink.emit('context_usage', {
      systemTokens: systemTokens + toolsTokens,
      messageTokens: priorTokens,
      promptTokens,
      contextWindow: this.contextWindow,
    })

    // Build messages: system + prior conversation + current prompt
    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    for (const m of effectivePriorMessages) {
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content })
      }
    }

    messages.push({ role: 'user', content: prompt })

    // Agent loop
    const maxIterations = 20
    for (let i = 0; i < maxIterations; i++) {
      if (this.abortController.signal.aborted) {
        eventSink.emit('done', {})
        return
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

      // Handle dispatch_sub_agents specially
      const subAgentCall = result.toolCalls.find(tc => tc.name === 'dispatch_sub_agents')
      if (subAgentCall) {
        const tasks = (subAgentCall.args as { tasks?: SubAgentTask[] }).tasks || []
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
        continue
      }

      // Execute regular tool calls
      for (const tc of result.toolCalls) {
        if (tc.name === 'dispatch_sub_agents') continue

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

        try {
          const toolResult = await tool.execute(tc.args as Record<string, unknown>)
          const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
          // Truncate large results — summarize rather than slice to keep valid JSON
          let truncated: string
          if (resultStr.length > 4000) {
            try {
              const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult
              if (Array.isArray(parsed)) {
                truncated = JSON.stringify({ count: parsed.length, sample: parsed.slice(0, 3), note: `Truncated. ${parsed.length} total items.` })
              } else if (typeof parsed === 'object' && parsed !== null) {
                const keys = Object.keys(parsed)
                const sample: Record<string, unknown> = {}
                for (const k of keys.slice(0, 5)) {
                  const val = parsed[k]
                  if (typeof val === 'object' && val !== null) {
                    sample[k] = Array.isArray(val) ? { count: val.length, sample: val.slice(0, 2) } : Object.keys(val as Record<string, unknown>).slice(0, 5)
                  } else {
                    sample[k] = val
                  }
                }
                truncated = JSON.stringify({ ...sample, _note: `Truncated. ${keys.length} total keys.` })
              } else {
                truncated = String(parsed).slice(0, 2000)
              }
            } catch {
              truncated = resultStr.slice(0, 3000) + '... (truncated)'
            }
          } else {
            truncated = resultStr
          }
          eventSink.emit('tool_result', { name: tc.name, result: toolResult, tool_call_id: `${tc.id || `${tc.name}_${i}`}` })
          messages.push({
            role: 'tool',
            content: truncated,
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
    const tools = defineAgentTools(this.qs, this.projectPath)
    const maxSubIterations = 10

    const runOne = async (task: SubAgentTask): Promise<string> => {
      eventSink.emit('sub_agent_start', { taskId: task.focus, task: task.task })

      const messages: OllamaMessage[] = [
        { role: 'system', content: `${systemPrompt}\n\nYou are a research sub-agent. Focus on: ${task.focus}. Provide a concise summary of your findings.` },
        { role: 'user', content: task.task },
      ]

      for (let i = 0; i < maxSubIterations; i++) {
        // Sub-agents use a silent sink — their output goes to the result, not the main stream
        const subSink = new SilentEventSink()
        const result = await this.streamChat(messages, ollamaTools, subSink)
        if (!result || result.toolCalls.length === 0) {
          eventSink.emit('sub_agent_result', { taskId: task.focus, result: result?.content || 'No findings' })
          return result?.content || 'No findings'
        }

        messages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.args } })),
        })

        for (const tc of result.toolCalls) {
          const tool = tools.find(t => t.name === tc.name)
          if (!tool) continue
          try {
            const toolResult = await tool.execute(tc.args as Record<string, unknown>)
            const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
            const truncated = resultStr.length > 3000 ? resultStr.slice(0, 3000) + '... (truncated)' : resultStr
            messages.push({ role: 'tool', content: truncated, tool_call_id: `${tc.name}_sub_${i}`, name: tc.name })
          } catch (err) {
            messages.push({ role: 'tool', content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), tool_call_id: `${tc.name}_sub_${i}`, name: tc.name })
          }
        }
      }

      eventSink.emit('sub_agent_result', { taskId: task.focus, result: 'Sub-agent reached iteration limit' })
      return 'Sub-agent reached iteration limit'
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