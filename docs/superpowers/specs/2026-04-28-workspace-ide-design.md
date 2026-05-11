# Workspace IDE Design

## Overview

Replace the placeholder `WorkspacePage` with a fully functional VS Code-like IDE interface within the existing A.U.R.A. app. The workspace provides file exploration, code editing, and terminal access for a project's filesystem path.

## Architecture

**Approach: Tightly Integrated** — All workspace components live in the `WorkspacePage` component tree, sharing React state. Layout uses CSS Grid with resizable panels.

## Layout

```
+-------+----------------------------------+
| File  | Tab1 | Tab2 | Tab3              |
| Exp.  |----------------------------------|
|       |                                  |
| (250px|        CodeMirror Editor        |
|  def, |                                  |
|  drag |                                  |
|  to   |                                  |
| resz) |                                  |
|       |                                  |
+-------+----------------------------------+
|  Terminal (200px default, drag to resize)|
|  (can be toggled open/closed with Ctrl+`) |
+------------------------------------------+
| Status Bar                               |
+------------------------------------------+
```

- File Explorer: Left panel, 250px default width, draggable resize, collapsible (Ctrl+B)
- Editor: Fills remaining space. Tab bar at top, CodeMirror below
- Terminal: Bottom panel, 200px default height, draggable resize, toggleable (Ctrl+`)
- Status Bar: Fixed at bottom

Dynamic behavior:
- File explorer hidden → editor spans full width
- Terminal hidden → editor spans full height
- Both hidden → editor fills everything

## Components

### FileExplorer (`src/components/workspace/FileExplorer.tsx`)
- Lazy-loaded directory tree (fetches one level at a time on expand)
- File type icons based on extension
- Right-click context menu: New File, New Folder, Rename, Delete
- Single click opens file in editor tab
- Active file highlighted
- Breadcrumb path at top

### EditorTabs (`src/components/workspace/EditorTabs.tsx`)
- Scrollable tab bar with file names and dirty state indicators (dot)
- Active tab highlighted, click to switch, middle-click to close
- X button on each tab, Ctrl+W closes active tab
- Unsaved changes prompt (save/discard/cancel) on close

### CodeEditor (`src/components/workspace/CodeEditor.tsx`)
- CodeMirror 6 instance per open file
- Preserves scroll position and cursor per tab
- Auto-detects language mode from file extension
- Language support: JS/TS/TSX/JSX, CSS, HTML, JSON, Markdown, Python, shell
- Dark theme matching existing app aesthetic
- Line numbers, foldable lines, bracket matching, auto-close brackets, indent
- Ctrl+S saves to server, clears dirty state
- Welcome tab when no files are open (project name, keyboard shortcuts)

### TerminalPanel (`src/components/workspace/TerminalPanel.tsx`)
- node-pty on server, xterm.js on client, connected via WebSocket
- Working directory defaults to project workspace path
- Multiple terminal instances (plus button to create new)
- Terminal tabs inside the panel (separate from editor tabs)
- Resizable via drag, toggleable via Ctrl+`
- Terminal fit handling (resize PTY on panel resize)

### StatusBar (`src/components/workspace/StatusBar.tsx`)
- Left: Git branch (if .git exists), workspace path
- Right: Language mode, line:col, encoding (UTF-8)

### PanelResizeHandle (`src/components/workspace/PanelResizeHandle.tsx`)
- Shared component for draggable resize dividers between panels
- Min/max constraints for panel sizes

## Server Endpoints

### File Operations
- `GET /api/projects/:id/files?path=` — List directory contents (name, type, size, modified). Returns children for directories. Lazy: one level at a time.
- `GET /api/projects/:id/file?path=` — Read file contents
- `PUT /api/projects/:id/file` — Save file contents (`{ path, content }`)
- `POST /api/projects/:id/file` — Create file or directory (`{ path, type: 'file'|'directory' }`)
- `DELETE /api/projects/:id/file?path=` — Delete file or directory
- `POST /api/projects/:id/file/move` — Rename/move (`{ oldPath, newPath }`)

### Terminal
- WebSocket server runs on the same port as Express, attached via `ws.createServer({ server })` sharing the HTTP server instance
- Connection path: `ws://host/api/projects/:id/terminal` (upgraded from HTTP)
- On connection, server spawns a `node-pty` process in the project's workspace directory
- Protocol: bidirectional binary frames for terminal I/O, JSON text frames for control
- Resize events sent as JSON control frames: `{ type: 'resize', cols, rows }`
- Client sends `{ type: 'stdin', data: string }` for input, receives `{ type: 'stdout', data: string }` and `{ type: 'stderr', data: string }` for output

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+S | Save current file |
| Ctrl+W | Close active tab |
| Ctrl+` | Toggle terminal panel |
| Ctrl+B | Toggle file explorer |
| Ctrl+N | New file (prompts for name in explorer) |
| Ctrl+Shift+N | New folder |
| Ctrl+Tab | Switch to next tab |
| Ctrl+Shift+Tab | Switch to previous tab |
| Ctrl+P | Quick file open (search files in workspace) |

## New Dependencies

- `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` — Core CM6
- `@codemirror/lang-javascript`, `@codemirror/lang-css`, `@codemirror/lang-html`, `@codemirror/lang-json`, `@codemirror/lang-markdown`, `@codemirror/lang-python` — Language modes
- `@codemirror/theme-one-dark` — Dark theme
- `@codemirror/autocomplete`, `@codemirror/search`, `@codemirror/lint` — Editor features
- `node-pty` — Server-side PTY
- `ws` — WebSocket server (for terminal transport)
- `xterm` — Terminal renderer (client-side)
- `@xterm/addon-fit` — Auto-fit terminal to container

## File Structure

```
src/components/workspace/
  FileExplorer.tsx
  FileExplorer.css
  EditorTabs.tsx
  EditorTabs.css
  CodeEditor.tsx
  CodeEditor.css
  TerminalPanel.tsx
  TerminalPanel.css
  StatusBar.tsx
  StatusBar.css
  PanelResizeHandle.tsx
  PanelResizeHandle.css
  WelcomeTab.tsx
  WelcomeTab.css

src/hooks/
  useWorkspace.ts        — File tree state, open files, active file, dirty tracking
  useTerminal.ts         — Terminal WebSocket connection management

server/routes/
  workspace.ts           — File operation endpoints (moved from projects router)
  terminal.ts            — WebSocket terminal endpoint

server/services/
  workspace.ts           — Filesystem operations (read, write, list, delete, rename)
  terminal.ts            — PTY management (spawn, resize, kill)
```

## State Management

`useWorkspace` hook manages:
- `fileTree`: Directory tree state (expanded nodes, cached children)
- `openFiles`: Array of `{ path, content, dirty }` for each open tab
- `activeFile`: Currently active file path
- `terminalVisible`: Boolean for terminal panel visibility
- `explorerVisible`: Boolean for file explorer visibility
- `terminalSessions`: Array of terminal session IDs

All state lives in React hooks (no Zustand needed — it's local to the workspace page).

## Error Handling

- File not found: Show error in editor, offer to create the file
- Save failure: Toast notification, keep dirty state
- Terminal disconnect: Show "Reconnect" button in terminal panel
- Permission denied: Toast notification with error details
- Binary file detection: Show "Binary file" placeholder instead of rendering content

## Security Considerations

- All file paths are validated server-side to ensure they stay within the project's workspace directory (path traversal prevention)
- File size limits for reading/saving (max 10MB per file)
- Terminal commands run with the server process's user permissions
- No arbitrary command execution from the REST API — only the WebSocket terminal allows interactive commands