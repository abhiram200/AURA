import fs from 'fs/promises'
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync } from 'fs'
import path from 'path'
import type { Response, Request } from 'express'

// ── Frame template with AURA branding ──────────────────────────────────────

const FRAME_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AURA Visual Companion</title>
  <style>
    /* ── Reset & Root ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-card: #1e2a4a;
      --text-primary: #e0e0e0;
      --text-secondary: #a0a0b0;
      --accent: #00f0ff;
      --accent-hover: #00c8d7;
      --accent-bg: rgba(0, 240, 255, 0.08);
      --success: #4ade80;
      --error: #ff3b30;
      --border: #2a2a4a;
      --radius: 10px;
      --shadow: 0 2px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--text-primary);
      background: var(--bg-primary);
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg-primary: #f5f5f7;
        --bg-secondary: #ffffff;
        --bg-card: #ffffff;
        --text-primary: #1d1d1f;
        --text-secondary: #6e6e73;
        --accent: #0071e3;
        --accent-hover: #005bb5;
        --accent-bg: rgba(0, 113, 227, 0.08);
        --success: #34c759;
        --error: #ff3b30;
        --border: #d2d2d7;
        --shadow: 0 2px 12px rgba(0,0,0,0.08);
      }
    }

    /* ── Layout ─────────────────────────────────────────────────── */
    body { display: flex; flex-direction: column; min-height: 100vh; background: var(--bg-primary); }
    .header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); }
    .header h1 { font-size: 14px; font-weight: 600; color: var(--accent); display: flex; align-items: center; gap: 8px; }
    .header h1 a { color: var(--accent); text-decoration: none; }
    .header .status { font-size: 12px; color: var(--success); }
    .main { flex: 1; overflow-y: auto; }
    #aura-visual-content { padding: 2rem; min-height: 100%; }
    .indicator-bar { text-align: center; padding: 10px 20px; border-top: 1px solid var(--border); background: var(--bg-secondary); font-size: 13px; color: var(--text-secondary); }
    .indicator-bar .selected-text { color: var(--accent); font-weight: 600; }

    /* ── Typography ─────────────────────────────────────────────── */
    h2 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; }
    h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .subtitle { color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.95rem; }
    .section { margin-bottom: 2rem; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.5rem; }
    p { line-height: 1.6; margin-bottom: 0.75rem; }
    code { background: var(--accent-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; color: var(--accent); }
    pre { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; overflow-x: auto; margin-bottom: 1rem; }
    pre code { background: none; padding: 0; color: var(--text-primary); }

    /* ── Options (A/B/C choices) ────────────────────────────────── */
    .options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 1.5rem; }
    .option { display: flex; align-items: flex-start; gap: 14px; padding: 14px 18px; border: 2px solid var(--border); border-radius: var(--radius); cursor: pointer; transition: all 0.2s; background: var(--bg-card); }
    .option:hover { border-color: var(--accent); background: var(--accent-bg); transform: translateY(-1px); box-shadow: var(--shadow); }
    .option.selected { border-color: var(--accent); background: var(--accent-bg); }
    .option .letter { flex-shrink: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: var(--bg-primary); font-weight: 700; font-size: 14px; color: var(--text-secondary); border: 1px solid var(--border); }
    .option.selected .letter { background: var(--accent); color: var(--bg-primary); border-color: var(--accent); }
    .option .content { flex: 1; }
    .option .content h3 { margin-bottom: 4px; }
    .option .content p { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0; }

    /* ── Cards (visual designs) ──────────────────────────────────── */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 1.5rem; }
    .card { border: 2px solid var(--border); border-radius: var(--radius); overflow: hidden; cursor: pointer; transition: all 0.2s; background: var(--bg-card); }
    .card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow); }
    .card.selected { border-color: var(--accent); border-width: 3px; }
    .card-image { padding: 1rem; min-height: 120px; background: var(--bg-secondary); }
    .card-body { padding: 12px 16px; }
    .card-body h3 { margin-bottom: 4px; }
    .card-body p { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0; }

    /* ── Mockup ─────────────────────────────────────────────────── */
    .mockup { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 1.5rem; background: var(--bg-card); }
    .mockup-header { background: var(--bg-secondary); padding: 8px 14px; border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
    .mockup-header::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
    .mockup-body { padding: 1rem; }

    /* ── Split view ─────────────────────────────────────────────── */
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 1.5rem; }
    @media (max-width: 700px) { .split { grid-template-columns: 1fr; } }

    /* ── Pros/Cons ───────────────────────────────────────────────── */
    .pros-cons { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 1.5rem; }
    @media (max-width: 600px) { .pros-cons { grid-template-columns: 1fr; } }
    .pros { background: rgba(74, 222, 128, 0.08); border: 1px solid rgba(74, 222, 128, 0.3); border-radius: var(--radius); padding: 1rem; }
    .cons { background: rgba(255, 59, 48, 0.08); border: 1px solid rgba(255, 59, 48, 0.3); border-radius: var(--radius); padding: 1rem; }
    .pros h4 { color: var(--success); margin-bottom: 8px; }
    .cons h4 { color: var(--error); margin-bottom: 8px; }
    .pros ul, .cons ul { padding-left: 20px; }
    .pros li, .cons li { margin-bottom: 4px; }

    /* ── Mock elements (wireframe building blocks) ───────────────── */
    .mock-nav { background: var(--bg-secondary); padding: 10px 16px; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 13px; display: flex; justify-content: space-between; }
    .mock-sidebar { background: var(--bg-secondary); padding: 16px; min-width: 180px; border-right: 1px solid var(--border); color: var(--text-secondary); font-size: 13px; }
    .mock-content { padding: 16px; flex: 1; }
    .mock-button { display: inline-block; background: var(--accent); color: var(--bg-primary); padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
    .mock-button:hover { background: var(--accent-hover); }
    .mock-input { display: inline-block; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 13px; color: var(--text-primary); min-width: 200px; }
    .placeholder { border: 2px dashed var(--border); border-radius: var(--radius); padding: 2rem; text-align: center; color: var(--text-secondary); }

    /* ── Tables ─────────────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
    th, td { padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
    th { background: var(--bg-secondary); font-weight: 600; }
    tr:hover { background: var(--accent-bg); }

    /* ── Blockquote ─────────────────────────────────────────────── */
    blockquote { border-left: 3px solid var(--accent); padding: 0.5rem 1rem; background: var(--accent-bg); margin-bottom: 1rem; color: var(--text-secondary); }

    /* ── Lists ───────────────────────────────────────────────────── */
    ul, ol { padding-left: 1.5rem; margin-bottom: 1rem; }
    li { margin-bottom: 0.25rem; }

    /* ── Waiting state ──────────────────────────────────────────── */
    .waiting-container { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
    .waiting-container .subtitle { font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📐 AURA Visual Companion</h1>
    <div class="status" id="connection-status">Connected</div>
  </div>
  <div class="main">
    <div id="aura-visual-content">
      <!-- CONTENT -->
    </div>
  </div>
  <div class="indicator-bar">
    <span id="indicator-text">Click an option above, then return to the chat to continue</span>
  </div>
  <script>
    (function() {
      var projectId = null;
      // Extract projectId from URL path: /api/aura/visual/{projectId}
      var pathMatch = window.location.pathname.match(/\\/api\\/aura\\/visual\\/([^/]+)/);
      if (pathMatch) { projectId = pathMatch[1]; }

      var WS_URL = 'ws://' + window.location.host + '/api/aura/visual/' + (projectId || 'unknown') + '/ws';
      var ws = null;
      var eventQueue = [];

      function connect() {
        try { ws = new WebSocket(WS_URL); } catch(e) { return; }
        ws.onopen = function() {
          eventQueue.forEach(function(e) { try { ws.send(JSON.stringify(e)); } catch(ex) {} });
          eventQueue = [];
          var el = document.getElementById('connection-status');
          if (el) el.textContent = 'Connected';
        };
        ws.onmessage = function(msg) {
          try {
            var data = JSON.parse(msg.data);
            if (data.type === 'reload') { window.location.reload(); }
          } catch(ex) {}
        };
        ws.onclose = function() {
          var el = document.getElementById('connection-status');
          if (el) el.textContent = 'Reconnecting...';
          setTimeout(connect, 3000);
        };
        ws.onerror = function() {
          try { ws.close(); } catch(ex) {}
        };
      }

      function sendEvent(event) {
        event.timestamp = Date.now();
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify(event)); } catch(ex) {}
        } else {
          eventQueue.push(event);
        }
      }

      document.addEventListener('click', function(e) {
        var target = e.target.closest('[data-choice]');
        if (!target) return;
        sendEvent({ type: 'click', text: target.textContent.trim(), choice: target.dataset.choice, id: target.id || null });
        setTimeout(function() {
          var indicator = document.getElementById('indicator-text');
          if (!indicator) return;
          var container = target.closest('.options') || target.closest('.cards');
          var selected = container ? container.querySelectorAll('.selected') : [];
          if (selected.length === 0) {
            indicator.textContent = 'Click an option above, then return to the chat to continue';
          } else if (selected.length === 1) {
            var label = (selected[0].querySelector('h3, .content h3, .card-body h3') || {}).textContent;
            label = label ? label.trim() : selected[0].dataset.choice;
            indicator.innerHTML = '<span class="selected-text">' + label + '</span> selected — return to chat to continue';
          } else {
            indicator.innerHTML = '<span class="selected-text">' + selected.length + '</span> selected — return to chat to continue';
          }
        }, 0);
      });

      window.toggleSelect = function(el) {
        var container = el.closest('.options') || el.closest('.cards');
        var multi = container && container.dataset.multiselect !== undefined;
        if (container && !multi) {
          container.querySelectorAll('.option, .card').forEach(function(o) { o.classList.remove('selected'); });
        }
        if (multi) { el.classList.toggle('selected'); }
        else { el.classList.add('selected'); }
      };

      connect();
    })();
  </script>
</body>
</html>`

const WAITING_PAGE = `<div class="waiting-container">
  <p class="subtitle">Continuing in chat...</p>
</div>`

// ── Visual companion state ────────────────────────────────────────────────

interface VisualCompanionState {
  screenDir: string
  stateDir: string
  eventsFile: string
  lastActivity: number
  knownFiles: Set<string>
  clients: Set<any> // WebSocket clients for this project
  idleTimer: NodeJS.Timeout | null
}

const companions = new Map<string, VisualCompanionState>()

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function isFullDocument(html: string): boolean {
  return html.trimStart().startsWith('<!DOCTYPE') || html.trimStart().startsWith('<html')
}

function wrapInFrame(content: string): string {
  return FRAME_TEMPLATE.replace('<!-- CONTENT -->', content)
}

function getNewestScreen(screenDir: string): string | null {
  if (!existsSync(screenDir)) return null
  const files = readdirSync(screenDir)
    .filter(f => f.endsWith('.html'))
    .map(f => ({ name: f, mtime: statSync(path.join(screenDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (files.length === 0) return null
  return readFileSync(path.join(screenDir, files[0].name), 'utf-8')
}

// ── Public API ────────────────────────────────────────────────────────────

export interface VisualCompanionInfo {
  url: string
  screenDir: string
  stateDir: string
}

/**
 * Ensure the visual companion is ready for a project.
 * Creates directories if needed and starts tracking activity.
 */
export async function startVisualCompanion(projectPath: string, projectId?: string): Promise<VisualCompanionInfo> {
  const visualDir = path.join(projectPath, '.aura', 'visual')
  const screenDir = visualDir
  const stateDir = visualDir
  const eventsFile = path.join(stateDir, 'events')

  ensureDir(screenDir)

  let companion = companions.get(projectPath)
  if (!companion) {
    companion = {
      screenDir,
      stateDir,
      eventsFile,
      lastActivity: Date.now(),
      knownFiles: new Set(),
      clients: new Set(),
      idleTimer: null,
    }
    companions.set(projectPath, companion)

    // Scan existing files
    if (existsSync(screenDir)) {
      const files = await fs.readdir(screenDir)
      for (const f of files) {
        if (f.endsWith('.html')) {
          companion.knownFiles.add(f)
        }
      }
    }

    // Set up idle timer (30 min)
    resetIdleTimer(projectPath)
  } else {
    companion.lastActivity = Date.now()
    resetIdleTimer(projectPath)
  }

  return {
    url: `/api/aura/visual/${encodeURIComponent(projectId || path.basename(projectPath))}`,
    screenDir,
    stateDir,
  }
}

/**
 * Stop the visual companion for a project.
 */
export async function stopVisualCompanion(projectPath: string): Promise<void> {
  const companion = companions.get(projectPath)
  if (!companion) return

  // Close all WebSocket clients
  for (const client of companion.clients) {
    try { client.close(); } catch {}
  }

  if (companion.idleTimer) {
    clearTimeout(companion.idleTimer)
  }

  companions.delete(projectPath)
}

/**
 * Write a content fragment to the visual companion.
 * Returns the URL for the user to view.
 */
export async function writeScreen(projectPath: string, filename: string, content: string, title: string, projectId?: string): Promise<{ url: string; screenDir: string; stateDir: string }> {
  const info = await startVisualCompanion(projectPath)
  const companion = companions.get(projectPath)!

  // Ensure filename ends with .html
  const safeFilename = filename.replace(/[^a-zA-Z0-9_-]/g, '_') + '.html'
  const filePath = path.join(info.screenDir, safeFilename)

  // Write the content (either full document or fragment wrapped in frame)
  const html = isFullDocument(content) ? content : wrapInFrame(content)
  await fs.writeFile(filePath, html, 'utf-8')

  // Clear events file for new screen
  if (existsSync(info.stateDir)) {
    await fs.writeFile(path.join(info.stateDir, 'events'), '', 'utf-8').catch(() => {})
  }

  // Track the file
  const wasNew = !companion.knownFiles.has(safeFilename)
  companion.knownFiles.add(safeFilename)
  companion.lastActivity = Date.now()
  resetIdleTimer(projectPath)

  // Notify WebSocket clients
  broadcast(projectPath, { type: 'reload' })

  return {
    url: `/api/aura/visual/${encodeURIComponent(projectId || path.basename(projectPath))}`,
    screenDir: info.screenDir,
    stateDir: info.stateDir,
  }
}

/**
 * Read user interaction events from the visual companion.
 * Returns parsed events and clears the file.
 */
export async function readEvents(projectPath: string): Promise<Array<{ type: string; choice: string; text: string; id?: string; timestamp: number }>> {
  const companion = companions.get(projectPath)
  if (!companion) return []

  const eventsFile = companion.eventsFile
  if (!existsSync(eventsFile)) return []

  try {
    const content = await fs.readFile(eventsFile, 'utf-8')
    // Clear the events file after reading
    await fs.writeFile(eventsFile, '', 'utf-8').catch(() => {})

    const lines = content.trim().split('\n').filter(l => l.trim())
    return lines.map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter((e): e is NonNullable<typeof e> => e !== null)
  } catch {
    return []
  }
}

/**
 * Record an event from the browser to the events file.
 */
export async function recordEvent(projectPath: string, event: Record<string, unknown>): Promise<void> {
  const companion = companions.get(projectPath)
  if (!companion) return

  const eventsFile = companion.eventsFile
  const line = JSON.stringify(event) + '\n'
  await fs.appendFile(eventsFile, line, 'utf-8').catch(() => {})
}

/**
 * Check if a visual companion is active for a project.
 */
export function getVisualCompanion(projectPath: string, projectId?: string): VisualCompanionInfo | null {
  const companion = companions.get(projectPath)
  if (!companion) return null
  return {
    url: `/api/aura/visual/${encodeURIComponent(projectId || path.basename(projectPath))}`,
    screenDir: companion.screenDir,
    stateDir: companion.stateDir,
  }
}

/**
 * Add a WebSocket client for a project.
 */
export function addClient(projectPath: string, client: any): void {
  const companion = companions.get(projectPath)
  if (!companion) return
  companion.clients.add(client)
  client.on('close', () => {
    companion.clients.delete(client)
  })
}

/**
 * Remove a WebSocket client.
 */
export function removeClient(projectPath: string, client: any): void {
  const companion = companions.get(projectPath)
  if (!companion) return
  companion.clients.delete(client)
}

/**
 * Broadcast a message to all WebSocket clients for a project.
 */
function broadcast(projectPath: string, msg: Record<string, unknown>): void {
  const companion = companions.get(projectPath)
  if (!companion) return
  const data = JSON.stringify(msg)
  for (const client of companion.clients) {
    try {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data)
      }
    } catch {}
  }
}

/**
 * Reset the idle timer for a project's visual companion.
 * Auto-stops after 30 minutes of inactivity.
 */
function resetIdleTimer(projectPath: string): void {
  const companion = companions.get(projectPath)
  if (!companion) return

  if (companion.idleTimer) {
    clearTimeout(companion.idleTimer)
  }

  companion.idleTimer = setTimeout(() => {
    console.log(`[Visual Companion] Stopping companion for ${projectPath} due to inactivity`)
    stopVisualCompanion(projectPath)
  }, 30 * 60 * 1000) // 30 minutes
}

/**
 * Serve the visual companion page for a project.
 * Returns the newest HTML file wrapped in the frame, or a waiting page.
 */
export async function serveVisualPage(projectPath: string): Promise<string> {
  const companion = companions.get(projectPath)
  if (!companion) {
    return wrapInFrame(WAITING_PAGE)
  }

  const newestContent = getNewestScreen(companion.screenDir)
  if (!newestContent) {
    return wrapInFrame(WAITING_PAGE)
  }

  // If it's already a full document with our frame, serve as-is
  // (writeScreen already wraps fragments, so this should be ready to serve)
  return newestContent
}

/**
 * Serve a specific file from the visual companion directory.
 */
export async function serveVisualFile(projectPath: string, filename: string): Promise<string | null> {
  const companion = companions.get(projectPath)
  if (!companion) return null

  const filePath = path.join(companion.screenDir, filename)
  if (!existsSync(filePath)) return null

  return fs.readFile(filePath, 'utf-8')
}

/**
 * Get the project path from a project ID by looking up active companions.
 */
export function getProjectPathByDirName(dirName: string): string | null {
  for (const [projectPath] of companions) {
    if (path.basename(projectPath) === dirName) return projectPath
  }
  return null
}