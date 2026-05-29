export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

export function computeDiff(oldText: string, newText: string, contextLines: number = 3): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const { lcs } = lcsMatrix(oldLines, newLines)
  const full = buildDiffLines(oldLines, newLines, lcs, 0, 0)
  return collapseToHunks(full, contextLines)
}

export function collapseToHunks(lines: DiffLine[], context: number): DiffLine[] {
  const changeIdxs: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'context') changeIdxs.push(i)
  }
  if (changeIdxs.length === 0) return []

  const ranges: [number, number][] = []
  for (const ci of changeIdxs) {
    const start = Math.max(0, ci - context)
    const end = Math.min(lines.length - 1, ci + context)
    if (ranges.length === 0 || start > ranges[ranges.length - 1][1] + 1) {
      ranges.push([start, end])
    } else {
      ranges[ranges.length - 1][1] = Math.max(ranges[ranges.length - 1][1], end)
    }
  }

  const result: DiffLine[] = []
  for (let r = 0; r < ranges.length; r++) {
    const [start, end] = ranges[r]
    if (r > 0) {
      result.push({ type: 'context', content: '⋯' })
    }
    for (let i = start; i <= end; i++) {
      result.push(lines[i])
    }
  }
  return result
}

function lcsMatrix(a: string[], b: string[]) {
  const m = a.length
  const n = b.length
  if (m > 2000 || n > 2000) {
    return { lcs: new Set<string>() }
  }

  let prev = new Uint16Array(n + 1)
  const dp: Uint16Array[] = [new Uint16Array(n + 1)]

  for (let i = 1; i <= m; i++) {
    const curr = new Uint16Array(n + 1)
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
    dp.push(new Uint16Array(curr))
    prev = curr
  }

  const lcsSet = new Set<string>()
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcsSet.add(`${i - 1},${j - 1}`)
      i--; j--
    } else if (dp[i - 1][j]! >= dp[i][j - 1]!) {
      i--
    } else {
      j--
    }
  }
  return { lcs: lcsSet }
}

function buildDiffLines(oldLines: string[], newLines: string[], lcs: Set<string>, startOld: number, startNew: number): DiffLine[] {
  const result: DiffLine[] = []
  let oi = 0, ni = 0
  const lcsPairs = Array.from(lcs).map(s => s.split(',').map(Number)).sort((a, b) => a[0] - b[0])

  for (const [oIdx, nIdx] of lcsPairs) {
    while (oi < oIdx) {
      result.push({ type: 'remove', content: oldLines[oi], oldLineNo: startOld + oi + 1 })
      oi++
    }
    while (ni < nIdx) {
      result.push({ type: 'add', content: newLines[ni], newLineNo: startNew + ni + 1 })
      ni++
    }
    result.push({ type: 'context', content: oldLines[oi], oldLineNo: startOld + oi + 1, newLineNo: startNew + ni + 1 })
    oi++; ni++
  }
  while (oi < oldLines.length) {
    result.push({ type: 'remove', content: oldLines[oi], oldLineNo: startOld + oi + 1 })
    oi++
  }
  while (ni < newLines.length) {
    result.push({ type: 'add', content: newLines[ni], newLineNo: startNew + ni + 1 })
    ni++
  }
  return result
}

/** Format a write/update tool result as a diff string for context */
export function formatWriteUpdateDiff(tc: { name: string; args: Record<string, unknown>; result: unknown }): string | null {
  if (!tc.result || typeof tc.result !== 'object') return null
  const res = tc.result as { filePath?: string; previousContent?: string | null; created?: boolean; replacements?: number; applied?: boolean }
  const filePath = res.filePath || (tc.args as Record<string, unknown>)?.filePath as string || ''
  const previousContent = res.previousContent

  if (res.created) {
    const newContent = (tc.args as Record<string, unknown>)?.content as string ?? ''
    const lines = newContent.split('\n')
    let output = `[${tc.name}] ${filePath} (created, ${lines.length} lines)\n`
    for (let i = 0; i < lines.length; i++) {
      output += `+ ${lines[i]}\n`
    }
    return output
  }

  if (previousContent == null) return null

  const newContent = (tc.args as Record<string, unknown>)?.content as string
    ?? (tc.args as Record<string, unknown>)?.newString as string
    ?? ''

  let fullNewContent = newContent
  if (tc.name === 'update') {
    const oldString = (tc.args as Record<string, unknown>)?.oldString as string ?? ''
    const replaceAll = (tc.args as Record<string, unknown>)?.replaceAll as boolean ?? false
    const normalizedPrev = previousContent.replace(/\r\n/g, '\n')
    const normalizedOld = oldString.replace(/\r\n/g, '\n')
    const normalizedNew = newContent.replace(/\r\n/g, '\n')
    fullNewContent = replaceAll
      ? normalizedPrev.replaceAll(normalizedOld, normalizedNew)
      : normalizedPrev.replace(normalizedOld, normalizedNew)
  }

  const lines = computeDiff(previousContent.replace(/\r\n/g, '\n'), fullNewContent.replace(/\r\n/g, '\n'))
  const adds = lines.filter(l => l.type === 'add').length
  const removes = lines.filter(l => l.type === 'remove').length

  let output = `[${tc.name}] ${filePath} (+${adds} -${removes})\n`
  for (const line of lines) {
    const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
    output += `${prefix} ${line.content}\n`
  }
  return output
}