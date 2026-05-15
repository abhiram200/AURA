---
name: aura-exploring
description: How to explore and navigate the codebase — finding symbols, understanding architecture, tracing relationships
---

## Exploration Strategy

When exploring the codebase, work from the top down:

1. **Start with `context_manifest`** — get the full list of analyzed folders and their roles. This gives you a map of the project without reading any files.

2. **Drill into folders with `context_folder`** — for any folder that looks relevant, fetch its AI-generated context (role, exports, dependencies, summary). This is faster and more accurate than reading individual files.

3. **Find specific symbols with `search`** — when you know what you're looking for, search by name. Use `kinds` to filter by type (Function, Class, Interface, Method, Variable, Route, ApiCall).

4. **Understand a symbol with `context`** — once you've found a symbol, get its 360° view: who calls it, what it calls, its members, and its type hierarchy.

5. **Trace relationships with `dependents` / `dependencies`** — follow the dependency chain in either direction. Use `depth` to limit how far you go.

6. **For HTTP flows, use `route_map`** and `processes` / `process_detail` — these show you the API surface and request lifecycles.

## When to use search_pattern vs search

- **`search`** finds symbols by name in the indexed graph — fast, but limited to JS/TS/Python
- **`search_pattern`** does a regex grep across all source files — slower, but works for any language and catches comments, strings, and non-indexed references

Use `search_pattern` to verify import/usage claims, especially for re-exports, dynamic imports, or CommonJS patterns that the graph may miss.