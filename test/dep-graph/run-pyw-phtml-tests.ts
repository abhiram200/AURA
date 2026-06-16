/**
 * Test runner for .pyw and .phtml extension support.
 * These are variant extensions for Python and PHP that should use the same parsers.
 */
import { AuraParser } from '../../server/services/aura/parser.ts'
import fs from 'fs'
import path from 'path'

const parser = new AuraParser()
const testDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))

interface TestResult {
  file: string
  passed: boolean
  checks: { name: string; passed: boolean; detail?: string }[]
}

async function main() {
  await parser.init()
  console.log('Parser initialized\n')

  // ── .pyw Tests ──────────────────────────────────────────────────────────────

  // Test 1: gui_app.pyw — same as .py but with windowed mode
  const guiAppPyw = await runTest('gui_app.pyw', [
    check('GUIApp class', r => hasSymbol(r, 'GUIApp', 'Class')),
    check('import Logger', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('logger') || String(i.target).includes('logger'))),
    check('import load_config', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('config') || String(i.target).includes('config'))),
    check('run method', r => hasSymbol(r, 'run', 'Method')),
    check('show_message method', r => hasSymbol(r, 'show_message', 'Method')),
    check('create_app function', r => hasSymbol(r, 'create_app', 'Function')),
    check('__init__ method', r => hasSymbol(r, '__init__', 'Method')),
  ])

  // ── .phtml Tests ────────────────────────────────────────────────────────────

  // Test 2: layout.phtml — PHP embedded in HTML (same parser as .php)
  const layoutPhtml = await runTest('layout.phtml', [
    check('User import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('User') || String(i.target).includes('User'))),
    check('Renderer import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('Renderer') || String(i.target).includes('Renderer'))),
    check('getUser call', r => r.calls.some(c => String(c.metadata?.callName ?? '').includes('getUser') || String(c.target).includes('getUser'))),
    check('render call', r => r.calls.some(c => String(c.metadata?.callName ?? '').includes('render') || String(c.target).includes('render'))),
  ])

  // ── Summary ──────────────────────────────────────────────────────────────────

  const allResults = [guiAppPyw, layoutPhtml]

  let totalChecks = 0
  let totalPassed = 0
  let totalFailed = 0

  for (const result of allResults) {
    console.log(`\n${result.file}:`)
    for (const check of result.checks) {
      totalChecks++
      if (check.passed) {
        totalPassed++
        console.log(`  OK  ${check.name}`)
      } else {
        totalFailed++
        console.log(`  FAIL  ${check.name}${check.detail ? ' -- ' + check.detail : ''}`)
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Total: ${totalPassed}/${totalChecks} passed, ${totalFailed} failed`)
  console.log(`${'='.repeat(60)}`)

  if (totalFailed > 0) {
    process.exit(1)
  }
}

function check(name: string, fn: (r: any) => boolean): { name: string; check: (r: any) => boolean } {
  return { name, check: fn }
}

function hasSymbol(r: any, name: string, kind: string): boolean {
  return r.symbols.some((s: any) => s.name === name && s.kind === kind)
}

async function runTest(
  fileName: string,
  checks: { name: string; check: (r: any) => boolean }[],
): Promise<TestResult> {
  const filePath = path.join(testDir, fileName)
  let source: string
  try {
    source = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    return {
      file: fileName,
      passed: false,
      checks: [{ name: 'Read file', passed: false, detail: String(err) }],
    }
  }

  let result: any
  try {
    result = await parser.parseFile(fileName, source)
  } catch (err) {
    return {
      file: fileName,
      passed: false,
      checks: [{ name: 'Parse file', passed: false, detail: String(err) }],
    }
  }

  const checkResults = checks.map(c => {
    try {
      const passed = c.check(result)
      if (!passed) {
        const symbols = result.symbols?.map((s: any) => `${s.name}(${s.kind})`).join(', ') ?? 'none'
        const imports = result.imports?.map((i: any) => String(i.target)).join(', ') ?? 'none'
        const heritage = result.heritage?.map((h: any) => `${h.type}:${h.target}`).join(', ') ?? 'none'
        const calls = result.calls?.map((c: any) => String(c.metadata?.callName ?? c.target)).join(', ') ?? 'none'
        return { name: c.name, passed: false, detail: `Symbols: [${symbols}] | Imports: [${imports}] | Heritage: [${heritage}] | Calls: [${calls}]` }
      }
      return { name: c.name, passed: true }
    } catch (e: any) {
      return { name: c.name, passed: false, detail: e.message }
    }
  })

  return {
    file: fileName,
    passed: checkResults.every(c => c.passed),
    checks: checkResults,
  }
}

main().catch(err => {
  console.error('Test runner failed:', err)
  process.exit(1)
})