/**
 * Test runner for PHP and Java parser support.
 * Parses each test file and validates that the expected symbols, imports, and heritage are extracted.
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

  // ── PHP Tests ────────────────────────────────────────────────────────────────

  // Test 1: User.php — class, trait, enum, use statements, trait use, extends, implements
  const userPhp = await runTest('User.php', [
    check('User class', r => hasSymbol(r, 'User', 'Class')),
    check('Timestampable trait', r => hasSymbol(r, 'Timestampable', 'Trait')),
    check('UserRole enum', r => hasSymbol(r, 'UserRole', 'Enum')),
    check('use RenderableInterface import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('RenderableInterface') || String(i.target).includes('RenderableInterface'))),
    check('User implements RenderableInterface', r => r.heritage.some(h => String(h.target).includes('RenderableInterface') && h.type === 'IMPLEMENTS')),
    check('User uses Timestampable', r => r.heritage.some(h => String(h.target).includes('Timestampable') && h.metadata?.heritageKind === 'use-trait')),
    check('getCreatedAt method', r => hasSymbol(r, 'getCreatedAt', 'Method')),
    check('isAdmin method', r => hasSymbol(r, 'isAdmin', 'Method')),
  ])

  // Test 2: UserRepository.php — class, use statements, method calls, implements
  const userRepoPhp = await runTest('UserRepository.php', [
    check('UserRepository class', r => hasSymbol(r, 'UserRepository', 'Class')),
    check('use Connection import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('Connection') || String(i.target).includes('Connection'))),
    check('use NotFoundException import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('NotFoundException') || String(i.target).includes('NotFoundException'))),
    check('use RepositoryInterface import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('RepositoryInterface') || String(i.target).includes('RepositoryInterface'))),
    check('implements RepositoryInterface', r => r.heritage.some(h => String(h.target).includes('RepositoryInterface') && h.type === 'IMPLEMENTS')),
    check('findById method', r => hasSymbol(r, 'findById', 'Method')),
    check('save method', r => hasSymbol(r, 'save', 'Method')),
  ])

  // Test 3: RepositoryInterface.php — interface with methods
  const repoInterfacePhp = await runTest('RepositoryInterface.php', [
    check('RepositoryInterface interface', r => hasSymbol(r, 'RepositoryInterface', 'Interface')),
    check('findById method', r => hasSymbol(r, 'findById', 'Method')),
    check('findAll method', r => hasSymbol(r, 'findAll', 'Method')),
    check('save method', r => hasSymbol(r, 'save', 'Method')),
  ])

  // Test 4: NotFoundException.php — class extends
  const notFoundPhp = await runTest('NotFoundException.php', [
    check('NotFoundException class', r => hasSymbol(r, 'NotFoundException', 'Class')),
    check('extends RuntimeException', r => r.heritage.some(h => String(h.target).includes('RuntimeException') && h.type === 'EXTENDS')),
    check('getResource method', r => hasSymbol(r, 'getResource', 'Method')),
  ])

  // Test 5: helpers.php — require_once/include_once
  const helpersPhp = await runTest('helpers.php', [
    check('require_once User.php import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('User.php') || String(i.target).includes('User.php'))),
    check('require_once UserRepository.php import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('UserRepository.php') || String(i.target).includes('UserRepository.php'))),
    check('include_once NotFoundException.php', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('NotFoundException.php') || String(i.target).includes('NotFoundException.php'))),
    check('use User import', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('User') || String(i.target).includes('User'))),
    check('createUser function', r => hasSymbol(r, 'createUser', 'Function')),
    check('formatUser function', r => hasSymbol(r, 'formatUser', 'Function')),
  ])

  // ── Java Tests ──────────────────────────────────────────────────────────────

  // Test 6: UserService.java — class, imports, method calls, extends
  const userServiceJava = await runTest('UserService.java', [
    check('UserService class', r => hasSymbol(r, 'UserService', 'Class')),
    check('import User', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('User') || String(i.target).includes('User'))),
    check('import UserRepository', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('UserRepository') || String(i.target).includes('UserRepository'))),
    check('findById method', r => hasSymbol(r, 'findById', 'Method')),
    check('findAll method', r => hasSymbol(r, 'findAll', 'Method')),
    check('save method', r => hasSymbol(r, 'save', 'Method')),
    check('repository.findById call', r => r.calls.some(c => String(c.metadata?.callName ?? '').includes('findById') || String(c.target).includes('findById'))),
    check('repository.findAll call', r => r.calls.some(c => String(c.metadata?.callName ?? '').includes('findAll') || String(c.target).includes('findAll'))),
  ])

  // Test 7: User.java — class, implements, method declarations, field declarations
  const userJava = await runTest('User.java', [
    check('User class', r => hasSymbol(r, 'User', 'Class')),
    check('implements Renderable', r => r.heritage.some(h => h.target === 'Renderable' && h.type === 'IMPLEMENTS')),
    check('getId method', r => hasSymbol(r, 'getId', 'Method')),
    check('isAdmin method', r => hasSymbol(r, 'isAdmin', 'Method')),
    check('render method', r => hasSymbol(r, 'render', 'Method')),
  ])

  // Test 8: UserRole.java — enum declaration
  const userRoleJava = await runTest('UserRole.java', [
    check('UserRole enum', r => hasSymbol(r, 'UserRole', 'Enum')),
    check('getValue method', r => hasSymbol(r, 'getValue', 'Method')),
  ])

  // Test 9: Renderable.java — interface
  const renderableJava = await runTest('Renderable.java', [
    check('Renderable interface', r => hasSymbol(r, 'Renderable', 'Interface')),
    check('render method', r => hasSymbol(r, 'render', 'Method')),
  ])

  // Test 10: UserRepository.java — interface with methods
  const userRepoJava = await runTest('UserRepository.java', [
    check('UserRepository interface', r => hasSymbol(r, 'UserRepository', 'Interface')),
    check('findById method', r => hasSymbol(r, 'findById', 'Method')),
    check('findAll method', r => hasSymbol(r, 'findAll', 'Method')),
    check('import User', r => r.imports.some(i => String(i.metadata?.rawImportPath ?? '').includes('User') || String(i.target).includes('User'))),
  ])

  // Test 11: NotFoundException.java — class extends
  const notFoundJava = await runTest('NotFoundException.java', [
    check('NotFoundException class', r => hasSymbol(r, 'NotFoundException', 'Class')),
    check('extends RuntimeException', r => r.heritage.some(h => h.target === 'RuntimeException' && h.type === 'EXTENDS')),
    check('getResource method', r => hasSymbol(r, 'getResource', 'Method')),
  ])

  // ── Summary ────────────────────────────────────────────────────────────────

  const allResults = [userPhp, userRepoPhp, repoInterfacePhp, notFoundPhp, helpersPhp,
    userServiceJava, userJava, userRoleJava, renderableJava, userRepoJava, notFoundJava]

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