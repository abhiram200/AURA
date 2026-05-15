---
name: aura-impact
description: How to analyze change impact — understanding blast radius, risk assessment, and safe modifications
---

## Impact Analysis Strategy

Before recommending or making changes, assess the risk:

1. **Identify the symbol** — use `search` to find the exact node ID, or `search_pattern` if you're working with non-indexed code.

2. **Run `impact`** on the target symbol — this gives you downstream impact (who depends on this and will break) and upstream impact (what this symbol depends on), with severity scores.

3. **For API routes, use `api_impact`** — this combines consumers, shape mismatches, middleware, and risk level into a single report. More actionable than `impact` alone for endpoints.

4. **Use `shape_check`** for API changes** — if you're modifying a route's response, compare the current shape against how consumers actually use it. This catches breaking changes that `impact` alone might miss.

5. **Verify with `search_pattern`** — the indexed graph can have gaps. Always confirm "who imports X" or "is X used" by searching actual source files.

6. **For uncommitted changes, use `detect_changes`** — this analyzes git diff to find changed symbols and merges impact analysis on top.

## Risk levels

- **Critical** (score >= 0.8): Changes here will cascade widely. Proceed with caution, plan for extensive testing.
- **Moderate** (score >= 0.5): Some downstream effects. Review dependents before proceeding.
- **Low** (score < 0.5): Limited blast radius. Safe to change with normal review.