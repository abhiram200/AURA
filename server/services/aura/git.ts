import { execFile } from 'child_process'
import path from 'path'
import type { GitDiffOptions, FileDiff, HunkRange } from './types.ts'

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

export async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    const result = await execGit(['rev-parse', '--is-inside-work-tree'], projectPath)
    return result.trim() === 'true'
  } catch {
    return false
  }
}

export async function getCurrentBranch(projectPath: string): Promise<string | null> {
  try {
    const result = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath)
    return result.trim() || null
  } catch {
    return null
  }
}

export async function getGitDiff(projectPath: string, options: GitDiffOptions): Promise<FileDiff[]> {
  let args: string[]
  switch (options.scope) {
    case 'unstaged':
      args = ['diff']
      break
    case 'staged':
      args = ['diff', '--cached']
      break
    case 'all':
      args = ['diff', 'HEAD']
      break
    case 'compare':
      args = ['diff', `${options.base ?? 'HEAD~1'}..${options.head ?? 'HEAD'}`]
      break
  }
  args.push('--no-color', '--unified=0')

  let output: string
  try {
    output = await execGit(args, projectPath)
  } catch {
    return []
  }

  return parseUnifiedDiff(output)
}

function parseUnifiedDiff(output: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: FileDiff | null = null
  let isRename = false
  let renameFrom = ''

  for (const line of output.split('\n')) {
    // File header: diff --git a/foo b/bar
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      current = null
      isRename = false
      continue
    }

    // Rename detection
    if (line.startsWith('rename from ')) {
      isRename = true
      renameFrom = line.slice('rename from '.length)
      continue
    }
    if (line.startsWith('rename to ') && current) {
      current.status = 'renamed'
      current.oldFilePath = renameFrom
      continue
    }

    // New file path from +++ line
    if (line.startsWith('+++ b/')) {
      const filePath = normalizePath(line.slice(6))
      current = {
        filePath,
        status: 'modified',
        hunks: [],
      }
      // Check for new file
      if (output.includes(`--- /dev/null`)) {
        current.status = 'added'
      }
      continue
    }

    // Deleted file
    if (line.startsWith('+++ /dev/null') && current) {
      current.status = 'deleted'
      continue
    }

    // Hunk header: @@ -l,s +l,s @@
    const hunkMatch = line.match(/^@@@? -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunkMatch && current) {
      const startLine = parseInt(hunkMatch[1], 10)
      const count = parseInt(hunkMatch[2] ?? '1', 10)
      const endLine = startLine + count - 1
      current.hunks.push({ startLine, endLine })
    }
  }

  if (current) files.push(current)
  return files
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}