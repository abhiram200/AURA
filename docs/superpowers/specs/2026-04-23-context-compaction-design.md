# Context Compaction Design

## Problem
Current context management uses a rolling window + one-time summarization. The summary is generated once when messages exceed `contextWindowSize` and never updated. It becomes stale as the conversation evolves. Messages outside the window are lost.

## Solution: Progressive Context Compaction

Replace the one-time summary with a **working state** that is periodically rebuilt, plus a **hot tail** of recent messages kept verbatim.

### Context Assembly (New)

Layers sent to the LLM on each chat request:

1. **System prompt** — A.U.R.A. identity
2. **User preferences** — if set
3. **Persistent memory** — active remembered facts
4. **Working state** — structured summary of the full conversation so far (rebuilt periodically, never stale)
5. **Hot tail** — the most recent K messages verbatim, where K = contextWindowSize minus estimated overhead
6. **New user message** — the current user input

### Working State Structure

The working state is stored as a JSON object on the conversation:

```json
{
  "intent": "What the user is trying to accomplish overall",
  "decisions": ["Decision 1", "Decision 2"],
  "topics": ["Topic A", "Topic B"],
  "unresolved": ["Open question 1"]
}
```

This is injected as a system message formatted as:

```
[Conversation Context]
Intent: {intent}
Decisions: {decisions as bullet list}
Topics: {topics as bullet list}
Unresolved: {unresolved as bullet list}
```

### Compaction Trigger

After each chat response completes, if `messages.length > contextWindowSize * 1.5`, run compaction in the background. This threshold ensures compaction happens before context overflow but not on every message.

### Compaction Process

1. Send all conversation messages to the LLM with a structured extraction prompt
2. LLM returns a JSON working state
3. Replace `conversation.summary` with the new working state (JSON stringified)
4. The working state is rebuilt from scratch each time — never appended to, never stale

### Hot Tail Calculation

The hot tail keeps the most recent messages that fit within the remaining context budget:
- `hotTailSize = contextWindowSize - overhead` where overhead = system prompt + preferences + memory + working state + new message (estimated in messages, roughly 5-10 messages depending on window size)
- Minimum hot tail: 4 messages (2 exchanges)
- Maximum hot tail: contextWindowSize

### Storage Changes

The `Conversation.summary` field is repurposed to store the JSON working state string. No schema migration needed — the field already exists. The `ContextService.assemble()` method handles parsing it.

### Prompt for Compaction

A new prompt in `prompts.ts` that instructs the LLM to extract structured working state from the full conversation. Must produce valid JSON.

## Files Changed

- `server/prompts.ts` — add COMPACTION prompt
- `server/services/context.ts` — rewrite `assemble()` with working state + hot tail
- `server/routes/chat.ts` — replace old summarization with compaction trigger
- `server/storage/types.ts` — no changes needed (summary field reused)