import type { Response } from 'express'

export enum AgentEventType {
  Token = 'token',
  ToolCall = 'tool_call',
  ToolResult = 'tool_result',
  SubAgentStart = 'sub_agent_start',
  SubAgentResult = 'sub_agent_result',
  Done = 'done',
  Error = 'error',
}

export interface AgentEventSink {
  emit(event: AgentEventType, data: unknown): void
}

export class SSEEventSink implements AgentEventSink {
  private res: Response
  private closed = false

  constructor(res: Response) {
    this.res = res
  }

  emit(event: AgentEventType, data: unknown): void {
    if (this.closed) return
    try {
      this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      this.closed = true
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.res.write('event: done\ndata: {}\n\n')
      this.res.end()
    } catch {
      // Client already disconnected
    }
  }
}

export function setupSSEHeaders(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
}

// Silent sink — used by sub-agents to suppress their token/tool output
// from leaking into the main SSE stream. Only lifecycle events are forwarded.
export class SilentEventSink implements AgentEventSink {
  emit(_event: AgentEventType, _data: unknown): void {
    // Discard all events — sub-agent output is collected via return values
  }
}

// Collecting sink — captures all events for JSON mode (non-streaming)
// Returns aggregated content, tool calls, and errors as a single response.
export class CollectingEventSink implements AgentEventSink {
  tokens: string[] = []
  toolCalls: Array<{ name: string; args: Record<string, unknown>; toolCallId?: string; result?: unknown; error?: string; status: string }> = []
  errors: string[] = []

  emit(event: AgentEventType, data: unknown): void {
    const d = data as Record<string, unknown>
    switch (event) {
      case AgentEventType.Token:
        if (d.content) this.tokens.push(d.content as string)
        break
      case AgentEventType.ToolCall:
        this.toolCalls.push({
          name: d.name as string,
          args: (d.args as Record<string, unknown>) || {},
          toolCallId: d.tool_call_id as string | undefined,
          status: 'running',
        })
        break
      case AgentEventType.ToolResult:
        for (const tc of this.toolCalls) {
          const tcId = d.tool_call_id as string | undefined
          if (tcId ? tc.toolCallId === tcId : tc.name === d.name) {
            tc.result = d.result
            tc.error = d.error as string | undefined
            tc.status = d.error ? 'error' : 'completed'
            break
          }
        }
        break
      case AgentEventType.Error:
        this.errors.push(d.message as string)
        break
    }
  }
}