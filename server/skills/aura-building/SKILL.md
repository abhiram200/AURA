---
name: aura-building
description: How to build and scaffold projects, features, and modules from scratch or into existing codebases
---

## Build Workflow

For any task beyond a single-file quick fix, follow this workflow **in order**:

1. **Explore first.** Dispatch an `explore` sub-agent to understand the codebase structure, relevant files, and existing patterns. You cannot plan effectively without understanding what already exists.

2. **Research if needed.** If the task requires external knowledge (APIs, library versions, framework docs), dispatch a `research` sub-agent. Skip this step if not needed.

3. **Ask clarifying questions.** If the user's request is vague or you have ambiguities about requirements (technology choices, UI preferences, scope, etc.), use `ask_user` before planning. Don't guess on important decisions.

4. **Plan.** Dispatch a `plan` sub-agent with discoveries from explore/research AND any user decisions from `ask_user` as `preContext`. The plan should be structured as numbered steps with file paths and dependencies.

5. **Create a todo list from the plan.** Call `todo_write` immediately after the plan is approved. Each plan step becomes one todo item. Set `blockedBy` for steps that depend on earlier steps.

6. **Work through todos in order.** Mark each `in_progress` before starting, `completed` after finishing.

7. **Verify each step.** After making changes for a todo, run build/test commands to verify before marking it completed.

8. **Commit after each completed todo.** Use `execute` to run `git add -A && git commit -m "type: description"`. Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.

**Deploy sub-agents sequentially** — explore → research (if needed) → plan. Each step builds on the previous one. Only dispatch multiple sub-agents together when they are genuinely independent.

## Project scaffolding

For new projects:
1. **Create .gitignore FIRST** — This is the very first step. Use `write` to create a proper .gitignore that **always includes `.aura/*`** plus entries for the project type (e.g., node_modules/, dist/, .env for Node.js; __pycache__/, .venv/, *.pyc for Python). Commit it before creating any other files.
2. If no git repo, the system will auto-initialize one with a placeholder .gitignore — overwrite it with the real one (must include `.aura/*`)
3. **Ask clarifying questions.** If the user's request is vague (e.g., "build me an app" without specifying tech stack, features, or UI), use `ask_user` to clarify before planning. Don't guess on tech choices, scope, or design decisions.
4. **Research if needed.** If you need external knowledge (library APIs, framework versions, setup guides), dispatch a `research` sub-agent. No `explore` sub-agent needed since there's no existing codebase.
5. **Plan.** Dispatch a `plan` sub-agent — include any user decisions from `ask_user` as `preContext`. Then create a todo list and implement as described in the Build Workflow.
5. Create the project structure: use `write` for package.json, tsconfig, config files, source files
6. Install dependencies via `execute`: `npm install` or `pip install`
7. Verify the project builds: `execute` the build command
8. Commit the initial scaffold

## Feature implementation

For adding features to existing codebases:
1. Dispatch an `explore` sub-agent to understand the codebase structure and where the feature fits
2. (Optional) Dispatch a `research` sub-agent if external knowledge is needed
3. Ask clarifying questions with `ask_user` if any requirements are ambiguous
4. Dispatch a `plan` sub-agent with explore/research discoveries AND user decisions as `preContext`
5. Create a feature branch if on main/master
6. Create a todo list from the approved plan
7. Build the feature following the todo list
8. Run tests after each significant change
9. Commit after each completed todo item

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