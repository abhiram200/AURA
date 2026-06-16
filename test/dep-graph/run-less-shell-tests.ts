/**
 * Less and Shell dependency graph test runner
 */
import { AuraParser } from '../../server/services/aura/parser.ts'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEST_DIR = __dirname

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  ✗ FAIL: ${message}`)
  }
}

async function main() {
  const parser = new AuraParser()
  await parser.init()
  console.log('Parser initialized\n')

  // ═══════════════════════════════════════════════════════════════════════
  // LESS TESTS
  // ═══════════════════════════════════════════════════════════════════════

  // ─── variables.less ───
  console.log('=== variables.less ===')
  const varsLessSource = fs.readFileSync(path.join(TEST_DIR, 'variables.less'), 'utf-8')
  const varsLessResult = await parser.parseFile(path.join(TEST_DIR, 'variables.less'), varsLessSource)

  // Imports
  const lessImports = varsLessResult.imports
  assert(lessImports.length >= 1, `variables.less imports >= 1, got ${lessImports.length}`)
  const mixinsImport = lessImports.find(i => i.target.includes('mixins'))
  assert(!!mixinsImport, 'mixins.less import found')

  // Symbols — selectors + at-rules + variables + mixins
  const lessSymbols = varsLessResult.symbols
  assert(lessSymbols.length >= 3, `variables.less symbols >= 3, got ${lessSymbols.length}`)

  // Less variables (at_rule nodes with @ prefix)
  const primaryColor = lessSymbols.find(s => s.name === '@primary-color')
  assert(!!primaryColor, '@primary-color variable found')

  const fontSizeBase = lessSymbols.find(s => s.name === '@font-size-base')
  assert(!!fontSizeBase, '@font-size-base variable found')

  // Selectors
  const btnSelector = lessSymbols.find(s => s.name === '.btn' && s.kind === 'Selector')
  assert(!!btnSelector, '.btn selector found')

  // At-rules
  const mediaAtRule = lessSymbols.find(s => s.name.startsWith('@media') && s.kind === 'AtRule')
  assert(!!mediaAtRule, '@media at-rule found')

  // Mixins (names are without the dot prefix since class_name is extracted)
  const borderRadiusMixin = lessSymbols.find(s => s.name === 'border-radius' && s.kind === 'Mixin')
  assert(!!borderRadiusMixin, 'border-radius mixin found')

  // ─── mixins.less ───
  console.log('\n=== mixins.less ===')
  const mixinsLessSource = fs.readFileSync(path.join(TEST_DIR, 'mixins.less'), 'utf-8')
  const mixinsLessResult = await parser.parseFile(path.join(TEST_DIR, 'mixins.less'), mixinsLessSource)

  const mixinSymbols = mixinsLessResult.symbols
  assert(mixinSymbols.length >= 3, `mixins.less symbols >= 3, got ${mixinSymbols.length}`)

  const clearfixMixin = mixinSymbols.find(s => s.name === 'clearfix' && s.kind === 'Mixin')
  assert(!!clearfixMixin, 'clearfix mixin found')

  const centerBlockMixin = mixinSymbols.find(s => s.name === 'center-block' && s.kind === 'Mixin')
  assert(!!centerBlockMixin, 'center-block mixin found')

  const spacingUnit = mixinSymbols.find(s => s.name === '@spacing-unit')
  assert(!!spacingUnit, '@spacing-unit variable found')

  const containerSel = mixinSymbols.find(s => s.name === '.container' && s.kind === 'Selector')
  assert(!!containerSel, '.container selector found')

  // Imports
  const mixinImports = mixinsLessResult.imports
  assert(mixinImports.length >= 1, `mixins.less imports >= 1, got ${mixinImports.length}`)
  const colorsImport = mixinImports.find(i => i.target.includes('colors'))
  assert(!!colorsImport, 'colors.less import found')

  // ═══════════════════════════════════════════════════════════════════════
  // SHELL TESTS
  // ═══════════════════════════════════════════════════════════════════════

  // ─── setup.sh ───
  console.log('\n=== setup.sh ===')
  const setupShSource = fs.readFileSync(path.join(TEST_DIR, 'setup.sh'), 'utf-8')
  const setupShResult = await parser.parseFile(path.join(TEST_DIR, 'setup.sh'), setupShSource)

  // Symbols
  const shSymbols = setupShResult.symbols
  assert(shSymbols.length >= 3, `setup.sh symbols >= 3, got ${shSymbols.length}`)

  const setupFn = shSymbols.find(s => s.name === 'setup' && s.kind === 'Function')
  assert(!!setupFn, 'setup function found')

  const validateFn = shSymbols.find(s => s.name === 'validate' && s.kind === 'Function')
  assert(!!validateFn, 'validate function found')

  const appName = shSymbols.find(s => s.name === 'APP_NAME' && s.kind === 'Variable')
  assert(!!appName, 'APP_NAME variable found')

  const appVersion = shSymbols.find(s => s.name === 'APP_VERSION' && s.kind === 'Variable')
  assert(!!appVersion, 'APP_VERSION variable found')

  const deployEnv = shSymbols.find(s => s.name === 'DEPLOY_ENV' && s.kind === 'Variable')
  assert(!!deployEnv, 'DEPLOY_ENV exported variable found')
  assert(deployEnv?.exported === true, 'DEPLOY_ENV is exported')

  // Imports (source/.)
  const shImports = setupShResult.imports
  assert(shImports.length >= 1, `setup.sh imports >= 1, got ${shImports.length}`)
  const helpersImport = shImports.find(i => i.target.includes('helpers'))
  assert(!!helpersImport, 'source ./helpers.sh import found')

  const envImport = shImports.find(i => i.target.includes('environment'))
  assert(!!envImport, '. /etc/environment import found')

  // Calls (non-builtin commands)
  const shCalls = setupShResult.calls
  const dockerCall = shCalls.find(c => c.metadata?.callName === 'docker')
  assert(!!dockerCall, 'docker call found')

  // ─── deploy.sh ───
  console.log('\n=== deploy.sh ===')
  const deployShSource = fs.readFileSync(path.join(TEST_DIR, 'deploy.sh'), 'utf-8')
  const deployShResult = await parser.parseFile(path.join(TEST_DIR, 'deploy.sh'), deployShSource)

  const deploySymbols = deployShResult.symbols
  assert(deploySymbols.length >= 3, `deploy.sh symbols >= 3, got ${deploySymbols.length}`)

  const buildFn = deploySymbols.find(s => s.name === 'build' && s.kind === 'Function')
  assert(!!buildFn, 'build function found')

  const deployFn = deploySymbols.find(s => s.name === 'deploy' && s.kind === 'Function')
  assert(!!deployFn, 'deploy function found')

  const rollbackFn = deploySymbols.find(s => s.name === 'rollback' && s.kind === 'Function')
  assert(!!rollbackFn, 'rollback function found')

  const projectName = deploySymbols.find(s => s.name === 'PROJECT_NAME' && s.kind === 'Variable')
  assert(!!projectName, 'PROJECT_NAME variable found')

  const buildId = deploySymbols.find(s => s.name === 'BUILD_ID' && s.kind === 'Variable')
  assert(!!buildId, 'BUILD_ID exported variable found')

  // Imports
  const deployImports = deployShResult.imports
  assert(deployImports.length >= 1, `deploy.sh imports >= 1, got ${deployImports.length}`)
  const setupImport = deployImports.find(i => i.target.includes('setup'))
  assert(!!setupImport, 'source ./setup.sh import found')

  // Calls (non-builtin commands)
  const deployCalls = deployShResult.calls
  const kubectlCall = deployCalls.find(c => c.metadata?.callName === 'kubectl')
  assert(!!kubectlCall, 'kubectl call found')

  const dockerPushCall = deployCalls.find(c => c.metadata?.callName === 'docker')
  assert(!!dockerPushCall, 'docker call found')

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`)
  console.log(`Less+Shell Tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})