---
name: aura-building
description: How to build and scaffold projects, features, and modules from scratch or into existing codebases
---

## Build Strategy

1. **Plan before building.** For anything beyond a single-file change, dispatch a `plan` sub-agent first. The plan should be structured as numbered steps with file paths and dependencies.

2. **Create a todo list from the plan.** Call `todo_write` immediately after receiving the plan. Each plan step becomes one todo item. Set `blockedBy` for steps that depend on earlier steps.

3. **Work through todos in order.** Mark each `in_progress` before starting, `completed` after finishing.

4. **Verify each step.** After making changes for a todo, run build/test commands to verify before marking it completed.

5. **Commit after each completed todo.** Use `execute` to run `git add -A && git commit -m "type: description"`. Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.

## Project scaffolding

For new projects:
1. **Create .gitignore FIRST** — This is the very first step. Use `write` to create a proper .gitignore for the project type (e.g., node_modules/, dist/, .env for Node.js; __pycache__/, .venv/, *.pyc for Python). Commit it before creating any other files.
2. If no git repo, the system will auto-initialize one with a placeholder .gitignore — overwrite it with the real one
3. Create the project structure: use `write` for package.json, tsconfig, config files, source files
4. Install dependencies via `execute`: `npm install` or `pip install`
5. Verify the project builds: `execute` the build command
6. Commit the initial scaffold

## Feature implementation

For adding features to existing codebases:
1. Dispatch a `plan` sub-agent to understand where the feature fits
2. Create a feature branch if on main/master (the system auto-branches for build tasks)
3. Create a todo list from the plan
4. Build the feature following the todo list
5. Run tests after each significant change
6. Commit after each completed todo item

## Structured plan format

When you dispatch a `plan` sub-agent, request the output in this format:

```
## Implementation Plan

### Step 1: [Title]
- Files to modify: [list]
- Changes: [description]
- Dependencies: [none or step IDs]

### Step 2: [Title]
...

### Verification
- [How to verify the changes work]
```

## Common patterns

- **Express API**: Create routes, middleware, controllers, models as separate files. Start with package.json, then server entry point, then individual modules.
- **React component**: Create component file, styles, tests. Use `write` for new files, `update` for modifying existing imports.
- **Database migration**: Create migration file, update schema types, add seed data. Run migration via `execute`.