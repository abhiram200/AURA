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

export async function getGitHead(projectPath: string): Promise<string | null> {
  try {
    const result = await execGit(['rev-parse', 'HEAD'], projectPath)
    return result.trim() || null
  } catch {
    return null
  }
}

export async function hasFileChangesBetween(projectPath: string, oldHead: string, newHead: string): Promise<boolean> {
  try {
    const result = await execGit(['diff', '--name-only', `${oldHead}..${newHead}`], projectPath)
    return result.trim().length > 0
  } catch {
    return true // assume changes on error to avoid skipping needed re-index
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

export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: number
  parentHashes: string[]
  refs: string[]
}

export interface GitBranch {
  name: string
  isHead: boolean
  isRemote: boolean
  commitHash: string
}

export async function getGitLog(projectPath: string, maxCount = 100): Promise<{ commits: GitCommit[]; branches: GitBranch[] }> {
  // Use %x01 (SOH) as field delimiter — safe since control chars can't appear in commit messages
  const logOutput = await execGit(
    ['log', '--all', `--max-count=${maxCount}`, '--format=%H%x01%h%x01%s%x01%an%x01%at%x01%P%x01%D'],
    projectPath
  )

  const commits: GitCommit[] = logOutput.trim().split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split('\x01')
      return {
        hash: parts[0] || '',
        shortHash: parts[1] || '',
        message: parts[2] || '',
        author: parts[3] || '',
        date: parseInt(parts[4], 10) || 0,
        parentHashes: parts[5] ? parts[5].split(' ').filter(Boolean) : [],
        refs: parts[6] ? parts[6].split(', ').filter(Boolean) : [],
      }
    })

  // Get branches — use git for-each-ref for reliable parsing
  // Local branches
  const localBranchOutput = await execGit(
    ['for-each-ref', '--format=%(refname:short) %(objectname:short)', 'refs/heads/'],
    projectPath
  )
  // Current branch
  let currentBranch = ''
  try {
    currentBranch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath)).trim()
  } catch { /* no HEAD — bare repo or similar */ }

  const branches: GitBranch[] = []
  for (const line of localBranchOutput.trim().split('\n').filter(l => l.trim())) {
    const spaceIdx = line.lastIndexOf(' ')
    const name = line.substring(0, spaceIdx).trim()
    const commitHash = line.substring(spaceIdx + 1).trim()
    if (name && commitHash) {
      branches.push({ name, commitHash, isHead: name === currentBranch, isRemote: false })
    }
  }

  // Remote branches
  try {
    const remoteBranchOutput = await execGit(
      ['for-each-ref', '--format=%(refname:short) %(objectname:short)', 'refs/remotes/'],
      projectPath
    )
    for (const line of remoteBranchOutput.trim().split('\n').filter(l => l.trim())) {
      const spaceIdx = line.lastIndexOf(' ')
      const name = line.substring(0, spaceIdx).trim()
      const commitHash = line.substring(spaceIdx + 1).trim()
      // Skip remote namespace entries like bare "origin" without a branch path
      if (!name || !name.includes('/') || !commitHash) continue
      branches.push({ name, commitHash, isHead: false, isRemote: true })
    }
  } catch { /* no remotes */ }

  return { commits, branches }
}

export async function gitCheckout(projectPath: string, branch: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execGit(['checkout', branch], projectPath)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Checkout failed' }
  }
}

export async function gitRevert(projectPath: string, commitHash: string, strategy: 'revert' | 'reset'): Promise<{ success: boolean; error?: string }> {
  try {
    if (strategy === 'revert') {
      await execGit(['revert', '--no-edit', commitHash], projectPath)
    } else {
      await execGit(['reset', '--soft', commitHash], projectPath)
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Revert/reset failed' }
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}