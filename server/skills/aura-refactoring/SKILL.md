---
name: aura-refactoring
description: How to refactor code safely — renaming, moving, extracting, and restructuring with minimal risk
---

## Refactoring Strategy

1. **Assess impact first** — before any refactoring, run `impact` on the symbol you plan to change. This tells you how many files will be affected and how severely.

2. **Use `rename` to preview changes** — this tool uses graph traversal and text search to find all references, returning a list of edits with confidence levels. It does NOT apply changes — use `update` to apply the edits you want.

3. **Verify with `search_pattern`** — after planning a rename or move, search for any references the graph might have missed (dynamic imports, string references, comments, config files).

4. **Use `dependents` and `dependencies`** to understand the full dependency surface before moving or extracting code.

5. **Edit with `update`** — for existing files, always use `update` (find-and-replace) instead of `write`. It's safer and preserves the rest of the file. Always `read_file` first to get the exact text.

6. **For new files, use `write`** — when extracting a module or creating a new file, use `write` to create it, then `update` to modify the imports in existing files.

7. **After editing, verify** — use `search_pattern` to check that imports resolve correctly and no broken references remain.

## Safe rename workflow

```
1. rename(nodeId, newName) → get list of edits with confidence
2. read_file(filePath) → see exact current content
3. update(filePath, oldString, newString) → apply each edit
4. search_pattern(newName) → verify all references updated
```

## Safe extract workflow

```
1. context(symbolId) → understand what it uses and who uses it
2. read_file(sourceFile) → get the code to extract
3. write(newFile, extractedCode) → create the new module
4. update(sourceFile, oldString, newString) → remove from old location, add import
5. search_pattern(oldName) → verify callers now import from new location
```