/**
 * Dart and Kotlin dependency graph test runner
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
  // DART TESTS
  // ═══════════════════════════════════════════════════════════════════════

  // ─── user.dart ───
  console.log('=== user.dart ===')
  const dartSource = fs.readFileSync(path.join(TEST_DIR, 'user.dart'), 'utf-8')
  const dartResult = await parser.parseFile(path.join(TEST_DIR, 'user.dart'), dartSource)

  // Symbols
  const dartSymbols = dartResult.symbols
  console.log('  Symbols:', dartSymbols.map(s => `${s.kind}:${s.name}`).join(', '))

  // Class
  const userClass = dartSymbols.find(s => s.name === 'User' && s.kind === 'Class')
  assert(!!userClass, 'User class found')

  // Mixin
  const loggerMixin = dartSymbols.find(s => s.name === 'Logger' && s.kind === 'Trait')
  assert(!!loggerMixin, 'Logger mixin found as Trait')

  // Extension
  const stringExt = dartSymbols.find(s => s.name === 'StringExtension' && s.kind === 'Class')
  assert(!!stringExt, 'StringExtension found as Class')
  assert(stringExt?.metadata?.dartExtension === true, 'StringExtension has dartExtension metadata')

  // Enum
  const userRole = dartSymbols.find(s => s.name === 'UserRole' && s.kind === 'Enum')
  assert(!!userRole, 'UserRole enum found')

  // Typedef
  const callbackType = dartSymbols.find(s => s.name === 'Callback' && s.kind === 'TypeAlias')
  assert(!!callbackType, 'Callback typedef found')

  // Top-level variable
  const appNameVar = dartSymbols.find(s => s.name === 'appName' && s.kind === 'Variable')
  assert(!!appNameVar, 'appName variable found')

  // Function
  const createUserFn = dartSymbols.find(s => s.name === 'createUser' && s.kind === 'Function')
  assert(!!createUserFn, 'createUser function found')

  // Methods
  const greetMethod = dartSymbols.find(s => s.name === 'greet' && s.kind === 'Method')
  assert(!!greetMethod, 'greet method found')

  const nameLengthGetter = dartSymbols.find(s => s.name === 'nameLength' && s.kind === 'Method')
  assert(!!nameLengthGetter, 'nameLength getter found')

  const displayNameSetter = dartSymbols.find(s => s.name === 'displayName' && s.kind === 'Method')
  assert(!!displayNameSetter, 'displayName setter found')

  // AdminUser class
  const adminUser = dartSymbols.find(s => s.name === 'AdminUser' && s.kind === 'Class')
  assert(!!adminUser, 'AdminUser class found')

  const promoteMethod = dartSymbols.find(s => s.name === 'promote' && s.kind === 'Method')
  assert(!!promoteMethod, 'promote method found')

  // Imports
  const dartImports = dartResult.imports
  assert(dartImports.length >= 2, `user.dart imports >= 2, got ${dartImports.length}`)

  const dartCoreImport = dartImports.find(i => i.target.includes('dart:core'))
  assert(!!dartCoreImport, 'dart:core import found')

  const flutterImport = dartImports.find(i => i.target.includes('flutter'))
  assert(!!flutterImport, 'package:flutter import found')

  const userImport = dartImports.find(i => i.target.includes('user.dart'))
  assert(!!userImport, 'user.dart relative import found')

  // Heritage
  const dartHeritage = dartResult.heritage
  const implementsSerializable = dartHeritage.find(h => h.target === 'Serializable' && h.type === 'IMPLEMENTS')
  assert(!!implementsSerializable, 'User implements Serializable heritage found')

  const extendsUser = dartHeritage.find(h => h.target === 'User' && h.type === 'EXTENDS')
  assert(!!extendsUser, 'AdminUser extends User heritage found')

  const withLogger = dartHeritage.find(h => h.target === 'Logger' && h.type === 'IMPLEMENTS')
  assert(!!withLogger, 'AdminUser with Logger heritage found')

  // ─── user_service.dart ───
  console.log('\n=== user_service.dart ===')
  const dartServiceSource = fs.readFileSync(path.join(TEST_DIR, 'user_service.dart'), 'utf-8')
  const dartServiceResult = await parser.parseFile(path.join(TEST_DIR, 'user_service.dart'), dartServiceSource)

  const dartServiceSymbols = dartServiceResult.symbols
  console.log('  Symbols:', dartServiceSymbols.map(s => `${s.kind}:${s.name}`).join(', '))

  const userService = dartServiceSymbols.find(s => s.name === 'UserService' && s.kind === 'Class')
  assert(!!userService, 'UserService class found')

  const addUserMethod = dartServiceSymbols.find(s => s.name === 'addUser' && s.kind === 'Method')
  assert(!!addUserMethod, 'addUser method found')

  const findUserMethod = dartServiceSymbols.find(s => s.name === 'findUser' && s.kind === 'Method')
  assert(!!findUserMethod, 'findUser method found')

  const saveAllMethod = dartServiceSymbols.find(s => s.name === 'saveAll' && s.kind === 'Method')
  assert(!!saveAllMethod, 'saveAll method found')

  // ═══════════════════════════════════════════════════════════════════════
  // KOTLIN TESTS
  // ═══════════════════════════════════════════════════════════════════════

  // ─── User.kt ───
  console.log('\n=== User.kt ===')
  const ktSource = fs.readFileSync(path.join(TEST_DIR, 'User.kt'), 'utf-8')
  const ktResult = await parser.parseFile(path.join(TEST_DIR, 'User.kt'), ktSource)

  const ktSymbols = ktResult.symbols
  console.log('  Symbols:', ktSymbols.map(s => `${s.kind}:${s.name}`).join(', '))

  // Data class → Struct
  const userStruct = ktSymbols.find(s => s.name === 'User' && s.kind === 'Struct')
  assert(!!userStruct, 'User data class found as Struct')

  // Interface
  const serializableIface = ktSymbols.find(s => s.name === 'Serializable' && s.kind === 'Interface')
  assert(!!serializableIface, 'Serializable interface found')

  // Enum
  const userRoleKt = ktSymbols.find(s => s.name === 'UserRole' && s.kind === 'Enum')
  assert(!!userRoleKt, 'UserRole enum found')

  // Type alias
  const callbackAlias = ktSymbols.find(s => s.name === 'UserCallback' && s.kind === 'TypeAlias')
  assert(!!callbackAlias, 'UserCallback typealias found')

  // Object declaration
  const dbConfig = ktSymbols.find(s => s.name === 'DatabaseConfig' && s.kind === 'Class')
  assert(!!dbConfig, 'DatabaseConfig object found as Class')
  assert(dbConfig?.metadata?.kotlinObject === true, 'DatabaseConfig has kotlinObject metadata')

  // Companion object
  const companion = ktSymbols.find(s => s.name === 'Companion' && s.kind === 'Class')
  assert(!!companion, 'Companion object found as Class')
  assert(companion?.metadata?.companion === true, 'Companion has companion metadata')

  // Top-level function
  const createUserKt = ktSymbols.find(s => s.name === 'createUser' && s.kind === 'Function')
  assert(!!createUserKt, 'createUser top-level function found')

  // Top-level variable
  const maxRetries = ktSymbols.find(s => s.name === 'maxRetries' && s.kind === 'Variable')
  assert(!!maxRetries, 'maxRetries top-level variable found')

  // Methods inside User class
  const toJsonMethod = ktSymbols.find(s => s.name === 'toJson' && s.kind === 'Method')
  assert(!!toJsonMethod, 'toJson method found')

  const createStaticMethod = ktSymbols.find(s => s.name === 'create' && s.kind === 'Method')
  assert(!!createStaticMethod, 'create companion method found')

  // Heritage
  const ktHeritage = ktResult.heritage
  const implementsSerializableKt = ktHeritage.find(h => h.target === 'Serializable' && h.type === 'IMPLEMENTS')
  assert(!!implementsSerializableKt, 'User implements Serializable heritage found')

  // Imports
  const ktImports = ktResult.imports
  assert(ktImports.length >= 1, `User.kt imports >= 1, got ${ktImports.length}`)

  const loggerImport = ktImports.find(i => i.target.includes('Logger'))
  assert(!!loggerImport, 'Logger import found')

  // ─── UserService.kt ───
  console.log('\n=== UserService.kt ===')
  const ktServiceSource = fs.readFileSync(path.join(TEST_DIR, 'UserService.kt'), 'utf-8')
  const ktServiceResult = await parser.parseFile(path.join(TEST_DIR, 'UserService.kt'), ktServiceSource)

  const ktServiceSymbols = ktServiceResult.symbols
  console.log('  Symbols:', ktServiceSymbols.map(s => `${s.kind}:${s.name}`).join(', '))

  const userServiceKt = ktServiceSymbols.find(s => s.name === 'UserService' && s.kind === 'Class')
  assert(!!userServiceKt, 'UserService class found')

  const iUserService = ktServiceSymbols.find(s => s.name === 'IUserService' && s.kind === 'Interface')
  assert(!!iUserService, 'IUserService interface found')

  const getUserMethod = ktServiceSymbols.find(s => s.name === 'getUser' && s.kind === 'Method')
  assert(!!getUserMethod, 'getUser method found')

  const saveUserMethod = ktServiceSymbols.find(s => s.name === 'saveUser' && s.kind === 'Method')
  assert(!!saveUserMethod, 'saveUser method found')

  // Heritage
  const ktServiceHeritage = ktServiceResult.heritage
  const implementsIUserService = ktServiceHeritage.find(h => h.target === 'IUserService' && h.type === 'IMPLEMENTS')
  assert(!!implementsIUserService, 'UserService implements IUserService heritage found')

  // Imports
  const ktServiceImports = ktServiceResult.imports
  assert(ktServiceImports.length >= 1, `UserService.kt imports >= 1, got ${ktServiceImports.length}`)

  const userImportKt = ktServiceImports.find(i => i.target.includes('User'))
  assert(!!userImportKt, 'User import found in UserService.kt')

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`)
  console.log(`Dart+Kotlin Tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})