# Project Mode UI Design

## Overview

Project Mode is a dedicated workspace for building projects within A.U.R.A. It provides a structured experience separate from casual chat, with persistent project tracking and a builder interface.

## Entry Points & Button States

The project mode button in the chat header has three behavioral states:

### 1. New Chat (enabled)
- Button is active and clickable
- Clicking navigates to `/project-mode` — the dashboard with tabs

### 2. Existing Chat — project_mode called & accepted (enabled)
- Button is active and clickable
- Clicking navigates to `/project-mode/:projectId` — the full-screen builder for that project (no tabs)

### 3. Existing Chat — project_mode NOT called, or user dismissed the modal (disabled)
- Button appears grayed out / disabled
- Clicking shows a popover with:
  - Title: "No Project Mode Conversation Found"
  - Message: "This chat doesn't have an active project mode session. Would you like to start a new project?"
  - **"Initiate New Project"** button → navigates to `/project-mode` on the New Project tab (no prompt carried over)
  - **"Cancel"** button → dismisses the popover

## Routes

| Route | View | Description |
|-------|------|-------------|
| `/project-mode` | Dashboard | Tabbed interface: My Projects / New Project |
| `/project-mode/:projectId` | Builder | Full-screen builder for a specific project |

## Dashboard View (`/project-mode`)

Two tabs:

### My Projects Tab (default)
- Grid of project cards
- Each card shows: project name, brief description, status badge (Active/Completed), date
- Clicking a card navigates to `/project-mode/:projectId`
- Empty state: "No projects yet. Create your first project!"

### New Project Tab
Three sequential steps:

1. **Loading Screen** — "Setting up your environment..." with a spinner
2. **Folder Picker** — Text input for path + "Browse" button for native OS folder picker
   - User types/pastes a path or uses Browse to select a folder
   - "Continue" button proceeds after a path is entered
3. **Builder Placeholder** — Shows project name, workspace path, and "coming soon" message

## Builder View (`/project-mode/:projectId`)

- Full-screen view (no tabs)
- Header with: back arrow (→ `/project-mode`), project name, status badge
- Main content: placeholder page with project workspace path displayed
- This will be expanded with the actual builder functionality when backend is built

## Component Architecture

### New/Modified Files

1. **`src/pages/ProjectModePage.tsx`** — Rewrite as the dashboard page with tabs (My Projects / New Project)
2. **`src/pages/ProjectModeBuilderPage.tsx`** — New file for the builder placeholder page
3. **`src/components/chat/ProjectModeModal.tsx`** — Existing, no changes needed
4. **`src/components/chat/ProjectModeButton.tsx`** — New component encapsulating the three button states and the disabled popover
5. **`src/hooks/useProjectMode.ts`** — New hook managing project mode state (active projects, current project, loading states)
6. **`src/App.tsx`** — Update routes to add `/project-mode/:projectId`

### Tracking Project Mode Acceptance

The button state depends on whether `project_mode` was called and accepted in the current conversation. Currently, `useChat` only has an in-memory `projectModeSuggested` boolean that resets on refresh. We need to persist the acceptance state:

- Add a `projectModeAccepted: boolean` field to the `Conversation` type in `server/storage/types.ts`
- When the user accepts project mode (in `acceptProjectMode`), update the conversation on the server via a PATCH or the existing update endpoint
- When loading a conversation, read this field to determine the button state
- Three possible states per conversation:
  1. `projectModeAccepted === true` → button enabled, clicking goes to builder
  2. `projectModeAccepted === false` (explicitly dismissed) → button disabled with popover
  3. `projectModeAccepted === undefined` (tool never called) → button disabled with popover

### State Management

`useProjectMode` hook manages:
- `projects: Project[]` — list of projects (placeholder: empty array or mock data)
- `activeProjectId: string | null` — current project if in builder view
- `view: 'my-projects' | 'new-project'` — current dashboard tab
- `setupStep: 'loading' | 'folder-picker' | 'builder'` — new project flow step

The button state logic lives in `ProjectModeButton` and reads from `useChat`'s conversation data (specifically `projectModeAccepted` on the active conversation).

### Project Data Model (Placeholder)

```typescript
interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'completed';
  createdAt: string;
  workspacePath: string;
}
```

This is a placeholder — no backend persistence yet. Projects will be stored in component state and lost on refresh until backend is implemented.

## Disabled Button Popover

When the project mode button is clicked in a conversation where project_mode was never called or was dismissed:
- The button is visually disabled (reduced opacity, no pointer cursor)
- On click, a popover appears next to the button
- Popover contains: title, message, "Initiate New Project" button, "Cancel" button
- "Initiate New Project" → `navigate('/project-mode', { state: { tab: 'new-project' } })`
- "Cancel" → closes the popover

## Folder Picker Implementation

- Text input: user can type or paste a folder path
- Browse button: uses the `<input type="file" webkitdirectory>` approach for native OS folder selection, or a backend endpoint for directory browsing
- For now (placeholder), the text input accepts any path string and the Browse button uses the native directory picker where supported, falling back to a simple text input

## Style & Animation

- Follows existing app theme (CSS variables, Framer Motion animations)
- Transitions between tabs use Framer Motion `AnimatePresence`
- Loading spinner matches existing app spinner style
- Cards use the same styling pattern as SettingsCard
- Popover uses same pattern as existing tooltip/popover components

## Out of Scope (Backend Work)

- Project persistence (saving/loading projects)
- Actual builder functionality
- File system operations on the selected folder
- Project creation API endpoints