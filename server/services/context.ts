import { SYSTEM_PROMPT } from '../prompts.ts'
import type { Message, MemoryEntry, Settings } from '../storage/types.ts'

export interface WorkingState {
  intent: string
  current_step: string
  decisions: string[]
  topics: string[]
  unresolved: string[]
}

// Rough token estimator: ~4 chars per token for English text
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export class ContextService {
  parseWorkingState(raw: string): WorkingState | null {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.intent === 'string') {
        return {
          intent: parsed.intent ?? '',
          current_step: typeof parsed.current_step === 'string' ? parsed.current_step : '',
          decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
          topics: Array.isArray(parsed.topics) ? parsed.topics : [],
          unresolved: Array.isArray(parsed.unresolved) ? parsed.unresolved : [],
        }
      }
    } catch {
      // Not valid JSON — treat as a plain-text summary from old conversations
    }
    return null
  }

  formatWorkingState(state: WorkingState): string {
    const lines: string[] = ['[Conversation Context]']
    lines.push(`Intent: ${state.intent}`)
    if (state.current_step) lines.push(`Current step: ${state.current_step}`)
    if (state.decisions.length > 0) {
      lines.push('Decisions:')
      for (const d of state.decisions) lines.push(`- ${d}`)
    }
    if (state.topics.length > 0) {
      lines.push('Topics:')
      for (const t of state.topics) lines.push(`- ${t}`)
    }
    if (state.unresolved.length > 0) {
      lines.push('Unresolved:')
      for (const u of state.unresolved) lines.push(`- ${u}`)
    }
    return lines.join('\n')
  }

  assemble(
    messages: Message[],
    newMessage: string,
    settings: Settings,
    memories: MemoryEntry[],
    summary: string,
  ): { role: string; content: string }[] {
    const context: { role: string; content: string }[] = []
    let tokensUsed = 0

    const budget = settings.contextWindowSize // now in tokens
    // Reserve 20% of budget for the model's response generation
    const inputBudget = Math.floor(budget * 0.8)

    // Layer 1: System prompt (always present)
    context.push({ role: 'system', content: SYSTEM_PROMPT })
    tokensUsed += estimateTokens(SYSTEM_PROMPT)

    // Layer 2: User preferences (if set)
    if (settings.preferencesSet) {
      const prefs = settings.preferences
      const prefLines: string[] = ['[User Preferences]']
      if (prefs.responseDetail) prefLines.push(`Detail level: ${prefs.responseDetail}`)
      if (prefs.technicalLevel) prefLines.push(`Technical level: ${prefs.technicalLevel}`)
      if (prefs.responseFormat) prefLines.push(`Response format: ${prefs.responseFormat}`)
      if (prefs.domains) prefLines.push(`Domains: ${prefs.domains}`)
      if (prefs.personality) prefLines.push(`Personality: ${prefs.personality}`)
      if (prefs.proactiveness) prefLines.push(`Proactiveness: ${prefs.proactiveness}`)
      if (prefs.languageStyle) prefLines.push(`Language: ${prefs.languageStyle}`)
      if (prefs.useOfExamples) prefLines.push(`Examples: ${prefs.useOfExamples}`)
      if (prefLines.length > 1) {
        const prefText = prefLines.join('\n')
        context.push({ role: 'system', content: prefText })
        tokensUsed += estimateTokens(prefText)
      }
    }

    // Layer 3: Persistent memory (active entries only)
    const activeMemories = memories.filter((m) => m.active)
    if (activeMemories.length > 0) {
      const memText = ['[Remembered Facts]', ...activeMemories.map((m) => `- ${m.fact}`)].join('\n')
      context.push({ role: 'system', content: memText })
      tokensUsed += estimateTokens(memText)
    }

    // Layer 4: Working state (structured compaction) or legacy summary
    if (summary) {
      const workingState = this.parseWorkingState(summary)
      if (workingState) {
        const stateText = this.formatWorkingState(workingState)
        context.push({ role: 'system', content: stateText })
        tokensUsed += estimateTokens(stateText)
      } else {
        // Legacy plain-text summary from old conversations
        const legacyText = `[Earlier Conversation Summary]\n${summary}`
        context.push({ role: 'system', content: legacyText })
        tokensUsed += estimateTokens(legacyText)
      }
    }

    // Layer 5: Hot tail — recent messages that fit within the remaining budget
    const newMessageTokens = estimateTokens(newMessage)
    const remainingBudget = inputBudget - tokensUsed - newMessageTokens
    const hotTailMessages = this.fitMessagesInBudget(messages, Math.max(0, remainingBudget))
    for (const msg of hotTailMessages) {
      context.push({ role: msg.role, content: msg.content })
    }

    // Layer 6: New user message
    context.push({ role: 'user', content: newMessage })

    return context
  }

  /** Walk backwards through messages, including as many as fit within the token budget */
  fitMessagesInBudget(messages: Message[], budget: number): Message[] {
    if (budget <= 0 || messages.length === 0) return []

    const result: Message[] = []
    let used = 0

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(messages[i].content)
      if (used + msgTokens > budget) break
      result.unshift(messages[i])
      used += msgTokens
    }

    // Always include at least the last 2 exchanges (4 messages) if they exist
    if (result.length < 4 && messages.length >= 4) {
      return messages.slice(-4)
    }

    return result
  }

  /** Estimate total tokens in a conversation's messages */
  estimateConversationTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  }

  /** Get the active path of messages from root to a leaf message */
  getActivePath(messages: Message[], leafId: string | null): Message[] {
    if (!leafId || messages.length === 0) return messages

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

  /** Find the best matching summary for a branch by walking up the parentId chain */
  findSummaryForBranch(summaries: Record<string, string> | undefined, activeLeafId: string | null | undefined, messages: Message[]): string | undefined {
    if (!summaries || !activeLeafId) return undefined

    // Direct match
    if (summaries[activeLeafId]) return summaries[activeLeafId]

    // Walk up parentId chain to find ancestor with a summary
    const msgMap = new Map(messages.map(m => [m.id, m]))
    let current = msgMap.get(activeLeafId)
    while (current) {
      if (current.parentId && summaries[current.parentId]) return summaries[current.parentId]
      current = current.parentId ? msgMap.get(current.parentId) : undefined
    }

    return undefined
  }

  /** Assemble context using the active path from a parentId */
  assembleFromPath(
    allMessages: Message[],
    parentId: string | null,
    newMessage: string,
    settings: Settings,
    memories: MemoryEntry[],
    summary: string,
  ): { role: string; content: string }[] {
    // Walk backwards from parentId to get the context path
    const pathMessages = this.getPathFromParent(allMessages, parentId)
    return this.assemble(pathMessages, newMessage, settings, memories, summary)
  }

  /** Walk backwards from a parentId to get the path of messages */
  private getPathFromParent(messages: Message[], parentId: string | null): Message[] {
    if (!parentId) return messages

    const msgMap = new Map(messages.map(m => [m.id, m]))
    const path: Message[] = []
    const visited = new Set<string>()
    let current: Message | undefined = msgMap.get(parentId)

    while (current && !visited.has(current.id)) {
      path.unshift(current)
      visited.add(current.id)
      current = current.parentId ? msgMap.get(current.parentId) : undefined
    }

    return path
  }
}