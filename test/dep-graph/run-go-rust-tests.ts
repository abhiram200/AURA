/**
 * Go and Rust dependency graph test runner
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
  // GO TESTS
  // ═══════════════════════════════════════════════════════════════════════

  // ─── main.go ───
  console.log('=== main.go ===')
  const mainGoSource = fs.readFileSync(path.join(TEST_DIR, 'main.go'), 'utf-8')
  const mainGoResult = await parser.parseFile(path.join(TEST_DIR, 'main.go'), mainGoSource)

  // Symbols
  const goSymbols = mainGoResult.symbols
  assert(goSymbols.length >= 8, `main.go symbols >= 8, got ${goSymbols.length}`)

  const pkg = goSymbols.find(s => s.name === 'main' && s.kind === 'Namespace')
  assert(!!pkg, 'package main found as Namespace')

  const mainFn = goSymbols.find(s => s.name === 'main' && s.kind === 'Function')
  assert(!!mainFn, 'func main found')

  const handlerIface = goSymbols.find(s => s.name === 'Handler' && s.kind === 'Interface')
  assert(!!handlerIface, 'Handler interface found')

  const serverStruct = goSymbols.find(s => s.name === 'Server' && s.kind === 'Struct')
  assert(!!serverStruct, 'Server struct found')

  const configAlias = goSymbols.find(s => s.name === 'Config' && s.kind === 'TypeAlias')
  assert(!!configAlias, 'Config type alias found')

  const startMethod = goSymbols.find(s => s.name === 'Server.Start' && s.kind === 'Method')
  assert(!!startMethod, 'Server.Start method found')

  const stopMethod = goSymbols.find(s => s.name === 'Server.Stop' && s.kind === 'Method')
  assert(!!stopMethod, 'Server.Stop method found')

  const versionVar = goSymbols.find(s => s.name === 'Version' && s.kind === 'Variable')
  assert(!!versionVar, 'Version var found')

  const maxRetries = goSymbols.find(s => s.name === 'MaxRetries' && s.kind === 'Variable')
  assert(!!maxRetries, 'MaxRetries const found')
  assert(maxRetries?.metadata?.kind === 'const', 'MaxRetries has const metadata')

  // Imports
  const goImports = mainGoResult.imports
  assert(goImports.length >= 3, `main.go imports >= 3, got ${goImports.length}`)
  const fmtImport = goImports.find(i => i.target === 'fmt')
  assert(!!fmtImport, 'fmt import found')
  assert(fmtImport?.metadata?.importKind === 'go-stdlib', `fmt import kind is go-stdlib, got ${fmtImport?.metadata?.importKind}`)
  const handlerImport = goImports.find(i => i.target === 'myproject/internal/handler')
  assert(!!handlerImport, 'myproject/internal/handler import found')

  // Heritage (embedding)
  const goHeritage = mainGoResult.heritage
  const handlerEmbed = goHeritage.find(h => h.target === 'Handler')
  assert(!!handlerEmbed, 'Server embeds Handler found')

  // Calls
  const goCalls = mainGoResult.calls
  const serveHTTPCall = goCalls.find(c => c.metadata?.callName?.includes('ServeHTTP'))
  assert(!!serveHTTPCall, 's.ServeHTTP() call found')

  // ─── handler.go ───
  console.log('\n=== handler.go ===')
  const handlerGoSource = fs.readFileSync(path.join(TEST_DIR, 'handler.go'), 'utf-8')
  const handlerGoResult = await parser.parseFile(path.join(TEST_DIR, 'handler.go'), handlerGoSource)

  const hSymbols = handlerGoResult.symbols
  assert(hSymbols.length >= 5, `handler.go symbols >= 5, got ${hSymbols.length}`)

  const hPkg = hSymbols.find(s => s.name === 'handler' && s.kind === 'Namespace')
  assert(!!hPkg, 'package handler found')

  const responderIface = hSymbols.find(s => s.name === 'Responder' && s.kind === 'Interface')
  assert(!!responderIface, 'Responder interface found')

  const apiHandlerStruct = hSymbols.find(s => s.name === 'APIHandler' && s.kind === 'Struct')
  assert(!!apiHandlerStruct, 'APIHandler struct found')

  const handleRequestMethod = hSymbols.find(s => s.name === 'APIHandler.HandleRequest' && s.kind === 'Method')
  assert(!!handleRequestMethod, 'APIHandler.HandleRequest method found')

  const newHandlerFn = hSymbols.find(s => s.name === 'NewHandler' && s.kind === 'Function')
  assert(!!newHandlerFn, 'NewHandler function found')

  // Heritage (double embedding)
  const hHeritage = handlerGoResult.heritage
  const httpHandlerEmbed = hHeritage.find(h => h.target.includes('Handler'))
  assert(!!httpHandlerEmbed, 'APIHandler embeds Handler found')

  const responderEmbed = hHeritage.find(h => h.target === 'Responder')
  assert(!!responderEmbed, 'APIHandler embeds Responder found')

  // ═══════════════════════════════════════════════════════════════════════
  // RUST TESTS
  // ═══════════════════════════════════════════════════════════════════════

  // ─── main.rs ───
  console.log('\n=== main.rs ===')
  const mainRsSource = fs.readFileSync(path.join(TEST_DIR, 'main.rs'), 'utf-8')
  const mainRsResult = await parser.parseFile(path.join(TEST_DIR, 'main.rs'), mainRsSource)

  const rsSymbols = mainRsResult.symbols
  assert(rsSymbols.length >= 8, `main.rs symbols >= 8, got ${rsSymbols.length}`)

  const rsMain = rsSymbols.find(s => s.name === 'main' && s.kind === 'Function')
  assert(!!rsMain, 'fn main found')

  const rsServer = rsSymbols.find(s => s.name === 'Server' && s.kind === 'Struct')
  assert(!!rsServer, 'Server struct found')

  const rsStatus = rsSymbols.find(s => s.name === 'Status' && s.kind === 'Enum')
  assert(!!rsStatus, 'Status enum found')

  const rsHandler = rsSymbols.find(s => s.name === 'Handler' && s.kind === 'Interface')
  assert(!!rsHandler, 'Handler trait found as Interface')

  const rsAdvanced = rsSymbols.find(s => s.name === 'AdvancedHandler' && s.kind === 'Interface')
  assert(!!rsAdvanced, 'AdvancedHandler trait found')

  const rsNetworkMod = rsSymbols.find(s => s.name === 'network' && s.kind === 'Namespace')
  assert(!!rsNetworkMod, 'mod network found as Namespace')

  const rsMaxRetries = rsSymbols.find(s => s.name === 'MAX_RETRIES' && s.kind === 'Variable')
  assert(!!rsMaxRetries, 'MAX_RETRIES const found')

  const rsSayHello = rsSymbols.find(s => s.name === 'say_hello' && s.kind === 'Macro')
  assert(!!rsSayHello, 'say_hello macro found')

  // Impl methods
  const rsHandleMethod = rsSymbols.find(s => s.name === 'Server::handle' && s.kind === 'Method')
  assert(!!rsHandleMethod, 'Server::handle impl method found')

  const rsNewMethod = rsSymbols.find(s => s.name === 'Server::new' && s.kind === 'Method')
  assert(!!rsNewMethod, 'Server::new inherent impl method found')

  const rsStartMethod = rsSymbols.find(s => s.name === 'Server::start' && s.kind === 'Method')
  assert(!!rsStartMethod, 'Server::start inherent impl method found')

  // Imports
  const rsImports = mainRsResult.imports
  assert(rsImports.length >= 3, `main.rs imports >= 3, got ${rsImports.length}`)
  const hashMapImport = rsImports.find(i => i.target === 'std::collections::HashMap')
  assert(!!hashMapImport, 'std::collections::HashMap import found')
  assert(hashMapImport?.metadata?.importKind === 'rust-stdlib', `HashMap import kind is rust-stdlib`)

  const readImport = rsImports.find(i => i.target === 'std::io::Read')
  assert(!!readImport, 'Read import from use list found')

  const userImport = rsImports.find(i => i.target === 'crate::models::User')
  assert(!!userImport, 'crate::models::User import found')
  assert(userImport?.metadata?.importKind === 'rust-local', `User import kind is rust-local`)

  // Heritage
  const rsHeritage = mainRsResult.heritage
  const implHandler = rsHeritage.find(h => h.target === 'Handler' && h.type === 'IMPLEMENTS')
  assert(!!implHandler, 'impl Handler for Server heritage found as IMPLEMENTS')

  const advExtends = rsHeritage.find(h => h.target === 'Handler' && h.metadata?.heritageKind === 'trait-supertrait')
  assert(!!advExtends, 'AdvancedHandler extends Handler supertrait found')

  // Calls
  const rsCalls = mainRsResult.calls
  const serverNewCall = rsCalls.find(c => c.metadata?.callName?.includes('Server::new'))
  assert(!!serverNewCall, 'Server::new() call found')

  const startCall = rsCalls.find(c => c.metadata?.callName?.includes('start'))
  assert(!!startCall, 'server.start() call found')

  // ─── lib.rs ───
  console.log('\n=== lib.rs ===')
  const libRsSource = fs.readFileSync(path.join(TEST_DIR, 'lib.rs'), 'utf-8')
  const libRsResult = await parser.parseFile(path.join(TEST_DIR, 'lib.rs'), libRsSource)

  const libSymbols = libRsResult.symbols
  assert(libSymbols.length >= 7, `lib.rs symbols >= 7, got ${libSymbols.length}`)

  const appStruct = libSymbols.find(s => s.name === 'App' && s.kind === 'Struct')
  assert(!!appStruct, 'App struct found')

  const appError = libSymbols.find(s => s.name === 'AppError' && s.kind === 'Enum')
  assert(!!appError, 'AppError enum found')

  const serviceTrait = libSymbols.find(s => s.name === 'Service' && s.kind === 'Interface')
  assert(!!serviceTrait, 'Service trait found')

  const adminTrait = libSymbols.find(s => s.name === 'AdminService' && s.kind === 'Interface')
  assert(!!adminTrait, 'AdminService trait found')

  const configMod = libSymbols.find(s => s.name === 'config' && s.kind === 'Namespace')
  assert(!!configMod, 'mod config found')

  const appVersion = libSymbols.find(s => s.name === 'APP_VERSION' && s.kind === 'Variable')
  assert(!!appVersion, 'APP_VERSION const found')

  const globalCount = libSymbols.find(s => s.name === 'GLOBAL_COUNT' && s.kind === 'Variable')
  assert(!!globalCount, 'GLOBAL_COUNT static found')

  // Heritage
  const libHeritage = libRsResult.heritage
  const implService = libHeritage.find(h => h.target === 'Service')
  assert(!!implService, 'impl Service for App heritage found')

  const adminExtends = libHeritage.find(h => h.target === 'Service' && h.metadata?.heritageKind === 'trait-supertrait')
  assert(!!adminExtends, 'AdminService extends Service supertrait found')

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`)
  console.log(`Go+Rust Tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})