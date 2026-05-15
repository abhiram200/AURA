---
name: aura-debugging
description: How to trace bugs and errors — finding root causes, tracing execution flows, and understanding failure paths
---

## Debugging Strategy

1. **Start with `search`** to find the symbol or file mentioned in the error. Search by the error message, function name, or class name.

2. **Use `context`** on the symbol — check what calls it (incoming refs) and what it calls (outgoing refs). Most bugs are in the call chain.

3. **Trace the execution flow** — if the error is in an HTTP handler, use `route_map` to find the route, then `process_detail` to trace the full request lifecycle (middleware → handler → services → calls).

4. **Use `search_pattern`** for error messages — grep for the exact error string, error code, or log message. This finds where it's thrown and all the places that catch or handle it.

5. **Read the source with `read_file`** — once you've narrowed down to a specific file/function, read it with an explicit line range. Give `startLine` and `endLine` to avoid truncation.

6. **Check dependents** — use `dependents` to see everything that might be affected by or contributing to the bug.

7. **Verify assumptions** — use `search_pattern` to confirm "is X actually used?" or "where does Y get imported?" before making claims.

## Common patterns

- **"Cannot read property of undefined"**: `context` on the symbol → find where it's initialized → `search_pattern` for assignments
- **"Module not found"**: `search_pattern` for the import statement → `dependencies` on the importing file
- **"Route not found"**: `route_map` to verify the route exists → `process_detail` to trace its handler
- **"TypeError: X is not a function"**: `context` on X → check what it actually exports → `search_pattern` for how callers use it