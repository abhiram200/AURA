/**
 * Test runner for C and C++ parser support.
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

  // ── C Tests ──────────────────────────────────────────────────────────────

  // Test 1: utils.h — struct, enum, typedef, function declarations
  const utilsH = await runTest('utils.h', [
    check('Point struct', r => hasSymbol(r, 'Point', 'Struct')),
    check('Color enum', r => hasSymbol(r, 'Color', 'Enum')),
    check('Comparator typedef', r => hasSymbol(r, 'Comparator', 'TypeAlias')),
    check('create_point function', r => hasSymbol(r, 'create_point', 'Function')),
    check('compare_points function', r => hasSymbol(r, 'compare_points', 'Function')),
    check('print_point function', r => hasSymbol(r, 'print_point', 'Function')),
  ])

  // Test 2: utils.c — #include, function definitions, static variable, calls
  const utilsC = await runTest('utils.c', [
    check('stdio include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('stdio'))),
    check('stdlib include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('stdlib'))),
    check('utils.h local include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('utils.h') && i.metadata?.importKind === 'c-local-include')),
    check('create_point function', r => hasSymbol(r, 'create_point', 'Function')),
    check('compare_points function', r => hasSymbol(r, 'compare_points', 'Function')),
    check('print_point function', r => hasSymbol(r, 'print_point', 'Function')),
    check('counter static variable', r => hasSymbol(r, 'counter', 'Variable')),
  ])

  // Test 3: main.c — #include, #define, function calls
  const mainC = await runTest('main.c', [
    check('stdio include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('stdio'))),
    check('utils.h local include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('utils.h'))),
    check('MAX_POINTS macro', r => hasSymbol(r, 'MAX_POINTS', 'Macro')),
    check('main function', r => hasSymbol(r, 'main', 'Function')),
    check('create_point call', r => r.calls.some(c => String(c.metadata?.callName ?? '').includes('create_point'))),
    check('print_point call', r => r.calls.some(c => String(c.metadata?.callName ?? '').includes('print_point'))),
  ])

  // ── C++ Tests ────────────────────────────────────────────────────────────

  // Test 4: Widget.hpp — class, namespace, method declarations
  const widgetHpp = await runTest('Widget.hpp', [
    check('MyApp namespace', r => hasSymbol(r, 'MyApp', 'Namespace')),
    check('Widget class', r => hasSymbol(r, 'Widget', 'Class')),
    check('getName method', r => hasSymbol(r, 'getName', 'Method')),
    check('setName method', r => hasSymbol(r, 'setName', 'Method')),
    check('getId method', r => hasSymbol(r, 'getId', 'Method')),
    check('render method', r => hasSymbol(r, 'render', 'Method')),
    check('string include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('string'))),
    check('vector include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('vector'))),
  ])

  // Test 5: Widget.cpp — #include, method definitions
  const widgetCpp = await runTest('Widget.cpp', [
    check('Widget.hpp include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('Widget.hpp') && i.metadata?.importKind === 'cpp-local-include')),
    check('getName method', r => hasSymbol(r, 'getName', 'Method')),
    check('setName method', r => hasSymbol(r, 'setName', 'Method')),
    check('getId method', r => hasSymbol(r, 'getId', 'Method')),
    check('render method', r => hasSymbol(r, 'render', 'Method')),
  ])

  // Test 6: Container.hpp — class inheritance, enum class, includes
  const containerHpp = await runTest('Container.hpp', [
    check('MyApp namespace', r => hasSymbol(r, 'MyApp', 'Namespace')),
    check('Container class', r => hasSymbol(r, 'Container', 'Class')),
    check('Widget.hpp include', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('Widget.hpp'))),
    check('Container extends Widget', r => r.heritage.some(h => String(h.target).includes('Widget') && h.type === 'EXTENDS')),
    check('Layout enum', r => hasSymbol(r, 'Layout', 'Enum')),
  ])

  // ── Summary ──────────────────────────────────────────────────────────────

  const allResults = [utilsH, utilsC, mainC, widgetHpp, widgetCpp, containerHpp]

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
        const imports = result.imports?.map((i: any) => `${i.target}(${i.metadata?.importKind ?? 'unknown'})`).join(', ') ?? 'none'
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