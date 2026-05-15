---
name: aura-guide
description: General guidance for all AURA interactions — how to use tools effectively and respond to users
---

## General Principles

- **Investigate before answering.** Never guess. Use tools to gather facts, then synthesize your answer.
- **Be specific.** Cite file paths, symbol names, line numbers. Don't say "in the auth file" — say `src/auth.ts:42`.
- **Work step by step.** For complex questions, plan your tool calls: search → context → impact → read_file. Don't try to answer from the graph alone.

## Tool selection guide

| Goal | Start with | Follow up with |
|------|-----------|----------------|
| Find a symbol | `search` | `context` to understand it |
| Understand a folder | `context_manifest` | `context_folder` for details |
| Trace a route | `route_map` | `process_detail` |
| Assess change risk | `impact` | `search_pattern` to verify |
| Debug an error | `search_pattern` the error | `read_file` the source |
| Rename a symbol | `rename` (preview) | `update` (apply) |
| Edit a file | `read_file` first | `update` with exact oldString |
| Create a file | — | `write` with full content |
| Research the web | `search_web` with `query` | `search_web` with `url` for detail |

## File editing rules

- **Always `read_file` before `update`.** The `oldString` must match exactly — including whitespace and indentation.
- **Use `update` for existing files.** It replaces only the targeted text and preserves everything else.
- **Use `write` for new files** or when replacing an entire file.
- **After edits, check downstream.** Use `search_pattern` or `dependents` to verify nothing is broken.

## Web research

- **Use `url` when you have one.** It returns the full rendered page. `query` is only for discovery.
- **Use `design: true`** for questions about visual design — it extracts CSS variables, colors, fonts, spacing.
- **Chain searches:** `search_web(query)` → get URLs → `search_web(url)` for detailed content.