import path from 'path'
import fs from 'fs'
import { Parser, Language, Query, type Tree } from 'web-tree-sitter'
import {
  AuraNodeKind,
  AuraEdgeType,
} from './types.ts'
import type {
  AuraNode,
  AuraEdge,
} from './types.ts'
import { AuraDataFlow } from './data-flow.ts'
import {
  JS_EXTENSIONS,
  TS_EXTENSIONS,
  PY_EXTENSIONS,
  CSS_EXTENSIONS,
  SCSS_EXTENSIONS,
  HTML_EXTENSIONS,
  VUE_EXTENSIONS,
  PHP_EXTENSIONS,
  JAVA_EXTENSIONS,
  C_EXTENSIONS,
  CPP_EXTENSIONS,
  CSHARP_EXTENSIONS,
  GO_EXTENSIONS,
  RUST_EXTENSIONS,
  PARSABLE_EXTENSIONS,
} from './extensions.ts'

export interface ParseResult {
  filePath: string
  symbols: AuraNode[]
  imports: AuraEdge[]
  calls: AuraEdge[]
  heritage: AuraEdge[]
  contains: AuraEdge[]
  dataFlow: AuraEdge[]
}

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'build',
  'coverage',
  '.next',
  'target',
  'vendor',
  '__pycache__',
  '.terraform',
  '.aura',
  'out',
  '.cache',
  '.vscode',
  '.idea',
])

const PY_BUILTINS = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple',
  'bool', 'bytes', 'bytearray', 'frozenset', 'complex', 'memoryview',
  'super', 'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
  'open', 'type', 'id', 'hash', 'repr', 'abs', 'max', 'min', 'sum',
  'any', 'all', 'round', 'hex', 'bin', 'oct', 'ord', 'chr', 'sorted', 'reversed',
  'map', 'filter', 'zip', 'enumerate', 'iter', 'next', 'input', 'format',
  'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'index', 'count',
  'sort', 'reverse', 'copy', 'keys', 'values', 'items', 'get', 'update',
  'encode', 'decode', 'split', 'join', 'strip', 'lstrip', 'rstrip', 'replace',
  'upper', 'lower', 'title', 'capitalize', 'startswith', 'endswith', 'find',
  '__init__', '__str__', '__repr__', '__len__', '__getitem__', '__setitem__',
  '__iter__', '__next__', '__eq__', '__hash__', '__call__', '__contains__',
  'staticmethod', 'classmethod', 'property', 'cls',
  // Flask/Django/FastAPI framework built-ins
  'Flask', 'jsonify', 'request', 'redirect', 'url_for', 'abort', 'make_response',
  'render_template', 'session', 'g', 'current_app', 'Blueprint', 'Response',
  'HttpResponse', 'JsonResponse', 'HttpRequest', 'urlpatterns',
  'get_json', 'route', 'run', 'config', 'register',
  // HTTP response/request methods (requests/httpx library)
  'json', 'raise_for_status', 'ok', 'status_code', 'text', 'content', 'headers',
])

export class AuraParser {
  private ready = false
  private jsLang: Language | null = null
  private tsLang: Language | null = null
  private tsxLang: Language | null = null
  private pyLang: Language | null = null
  private htmlLang: Language | null = null
  private cssLang: Language | null = null
  private scssLang: Language | null = null
  private phpLang: Language | null = null
  private javaLang: Language | null = null
  private cLang: Language | null = null
  private cppLang: Language | null = null
  private csharpLang: Language | null = null
  private goLang: Language | null = null
  private rustLang: Language | null = null
  private parser: Parser | null = null
  private dataFlowAnalyzer = new AuraDataFlow()

  async init(): Promise<void> {
    await Parser.init()

    this.parser = new Parser()

    const grammarsDir = path.join(process.cwd(), 'server', 'grammars')

    const jsWasm = path.join(grammarsDir, 'tree-sitter-javascript.wasm')
    const tsWasm = path.join(grammarsDir, 'tree-sitter-typescript.wasm')
    const tsxWasm = path.join(grammarsDir, 'tree-sitter-tsx.wasm')

    this.jsLang = await Language.load(jsWasm)
    this.tsLang = await Language.load(tsWasm)
    this.tsxLang = await Language.load(tsxWasm)

    try {
      const pyWasm = path.join(grammarsDir, 'tree-sitter-python.wasm')
      this.pyLang = await Language.load(pyWasm)
    } catch {
      console.warn('tree-sitter-python.wasm not found; Python support disabled')
    }

    try {
      const htmlWasm = path.join(grammarsDir, 'tree-sitter-html.wasm')
      this.htmlLang = await Language.load(htmlWasm)
    } catch {
      console.warn('tree-sitter-html.wasm not found; HTML support disabled')
    }

    try {
      const cssWasm = path.join(grammarsDir, 'tree-sitter-css.wasm')
      this.cssLang = await Language.load(cssWasm)
    } catch {
      console.warn('tree-sitter-css.wasm not found; CSS support disabled')
    }

    try {
      const scssWasm = path.join(grammarsDir, 'tree-sitter-scss.wasm')
      this.scssLang = await Language.load(scssWasm)
    } catch {
      console.warn('tree-sitter-scss.wasm not found; SCSS support disabled')
    }

    try {
      const phpWasm = path.join(grammarsDir, 'tree-sitter-php.wasm')
      this.phpLang = await Language.load(phpWasm)
    } catch {
      console.warn('tree-sitter-php.wasm not found; PHP support disabled')
    }

    try {
      const javaWasm = path.join(grammarsDir, 'tree-sitter-java.wasm')
      this.javaLang = await Language.load(javaWasm)
    } catch {
      console.warn('tree-sitter-java.wasm not found; Java support disabled')
    }

    try {
      const cWasm = path.join(grammarsDir, 'tree-sitter-c.wasm')
      this.cLang = await Language.load(cWasm)
    } catch {
      console.warn('tree-sitter-c.wasm not found; C support disabled')
    }

    try {
      const cppWasm = path.join(grammarsDir, 'tree-sitter-cpp.wasm')
      this.cppLang = await Language.load(cppWasm)
    } catch {
      console.warn('tree-sitter-cpp.wasm not found; C++ support disabled')
    }

    try {
      const csharpWasm = path.join(grammarsDir, 'tree-sitter-c_sharp.wasm')
      this.csharpLang = await Language.load(csharpWasm)
    } catch {
      console.warn('tree-sitter-c_sharp.wasm not found; C# support disabled')
    }

    try {
      const goWasm = path.join(grammarsDir, 'tree-sitter-go.wasm')
      this.goLang = await Language.load(goWasm)
    } catch {
      console.warn('tree-sitter-go.wasm not found; Go support disabled')
    }

    try {
      const rustWasm = path.join(grammarsDir, 'tree-sitter-rust.wasm')
      this.rustLang = await Language.load(rustWasm)
    } catch {
      console.warn('tree-sitter-rust.wasm not found; Rust support disabled')
    }

    // Note: tree-sitter-vue cannot be compiled to WASM due to its external scanner.
    // Vue SFC parsing uses regex-based block extraction + sub-parsing with JS/TS/CSS/SCSS grammars.
    // this.vueLang is not needed and remains null.

    this.ready = true
  }

  isReady(): boolean {
    return this.ready
  }

  selectLanguage(filePath: string): Language | null {
    const ext = path.extname(filePath)
    if (TS_EXTENSIONS.has(ext)) {
      if (ext === '.tsx') {
        return this.tsxLang
      }
      return this.tsLang
    }
    if (JS_EXTENSIONS.has(ext)) {
      return this.jsLang
    }
    if (PY_EXTENSIONS.has(ext)) {
      return this.pyLang
    }
    if (HTML_EXTENSIONS.has(ext)) {
      return this.htmlLang
    }
    if (CSS_EXTENSIONS.has(ext)) {
      return this.cssLang
    }
    if (SCSS_EXTENSIONS.has(ext)) {
      return this.scssLang
    }
    if (PHP_EXTENSIONS.has(ext)) {
      return this.phpLang
    }
    if (JAVA_EXTENSIONS.has(ext)) {
      return this.javaLang
    }
    if (C_EXTENSIONS.has(ext)) {
      return this.cLang
    }
    if (CPP_EXTENSIONS.has(ext)) {
      return this.cppLang
    }
    if (CSHARP_EXTENSIONS.has(ext)) {
      return this.csharpLang
    }
    if (GO_EXTENSIONS.has(ext)) {
      return this.goLang
    }
    if (RUST_EXTENSIONS.has(ext)) {
      return this.rustLang
    }
    // Vue doesn't use tree-sitter-vue (it has an incompatible external scanner).
    // parseVueFile uses regex-based block extraction + sub-parsing.
    if (VUE_EXTENSIONS.has(ext)) {
      return null // Vue blocks are parsed individually with their respective grammars
    }
    return null
  }

  isParsable(filePath: string): boolean {
    const ext = path.extname(filePath)
    return PARSABLE_EXTENSIONS.has(ext)
  }

  shouldIgnore(dirName: string): boolean {
    return IGNORED_DIRS.has(dirName)
  }

  async parseFile(filePath: string, source: string): Promise<ParseResult> {
    // Route to language-specific parsers
    const ext = path.extname(filePath)
    if (PY_EXTENSIONS.has(ext)) {
      return this.parsePythonFile(filePath, source)
    }
    if (CSS_EXTENSIONS.has(ext)) {
      return this.parseCssFile(filePath, source)
    }
    if (SCSS_EXTENSIONS.has(ext)) {
      return this.parseScssFile(filePath, source)
    }
    if (HTML_EXTENSIONS.has(ext)) {
      return this.parseHtmlFile(filePath, source)
    }
    if (PHP_EXTENSIONS.has(ext)) {
      return this.parsePhpFile(filePath, source)
    }
    if (JAVA_EXTENSIONS.has(ext)) {
      return this.parseJavaFile(filePath, source)
    }
    if (C_EXTENSIONS.has(ext)) {
      return this.parseCFile(filePath, source)
    }
    if (CPP_EXTENSIONS.has(ext)) {
      return this.parseCppFile(filePath, source)
    }
    if (CSHARP_EXTENSIONS.has(ext)) {
      return this.parseCSharpFile(filePath, source)
    }
    if (GO_EXTENSIONS.has(ext)) {
      return this.parseGoFile(filePath, source)
    }
    if (RUST_EXTENSIONS.has(ext)) {
      return this.parseRustFile(filePath, source)
    }
    if (VUE_EXTENSIONS.has(ext)) {
      return await this.parseVueFile(filePath, source)
    }

    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []

      // Track symbol IDs to deduplicate
      const seenIds = new Set<string>()

      // Collect export names: export default <name> and export { a, b, ... }
      const exportedNames = new Set<string>()
      this.collectExportNames(language, tree, exportedNames)

      // Extract functions
      this.extractWithQuery(
        language, tree, filePath,
        '(function_declaration name: (identifier) @name)',
        AuraNodeKind.Function,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract arrow functions stored in variables
      this.extractWithQuery(
        language, tree, filePath,
        '(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))',
        AuraNodeKind.Function,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract classes
      this.extractWithQuery(
        language, tree, filePath,
        '(class_declaration name: (type_identifier) @name)',
        AuraNodeKind.Class,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract interfaces
      this.extractWithQuery(
        language, tree, filePath,
        '(interface_declaration name: (type_identifier) @name)',
        AuraNodeKind.Interface,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract type aliases (e.g. export type Category = 'personal' | 'work' | ...)
      this.extractWithQuery(
        language, tree, filePath,
        '(type_alias_declaration name: (type_identifier) @name)',
        AuraNodeKind.TypeAlias,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract methods
      this.extractWithQuery(
        language, tree, filePath,
        '(method_definition name: (property_identifier) @name)',
        AuraNodeKind.Method,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract method signatures (TS interfaces/abstract classes)
      this.extractWithQuery(
        language, tree, filePath,
        '(method_signature name: (property_identifier) @name)',
        AuraNodeKind.Method,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract variables (skip those already captured as arrow functions)
      this.extractWithQuery(
        language, tree, filePath,
        '(lexical_declaration (variable_declarator name: (identifier) @name))',
        AuraNodeKind.Variable,
        symbols, contains, seenIds, exportedNames,
      )

      // Extract imports
      this.extractImports(language, tree, filePath, imports)

      // Extract call expressions
      this.extractCalls(language, tree, filePath, calls, symbols)

      // Extract JSX component references
      this.extractJsxComponents(language, tree, filePath, calls, symbols)

      // Extract heritage (extends/implements)
      this.extractHeritage(language, tree, filePath, heritage)

      // Extract data flow (parameter, return, JSX prop, assignment)
      const dataFlowEdges = this.dataFlowAnalyzer.analyze(language, tree, filePath, symbols, calls)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: dataFlowEdges }
    } finally {
      tree.delete()
    }
  }

  async parseDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = []
    await this.walkDirectory(dirPath, files)
    return files
  }

  private async walkDirectory(currentPath: string, files: string[]): Promise<void> {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (this.shouldIgnore(entry.name)) continue
        await this.walkDirectory(path.join(currentPath, entry.name), files)
      } else if (entry.isFile()) {
        const fullPath = path.join(currentPath, entry.name)
        if (this.isParsable(fullPath)) {
          files.push(fullPath)
        }
      }
    }
  }

  // ── Python parsing ────────────────────────────────────────────────────────

  private parsePythonFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      // Extract classes
      this.extractWithQuery(
        language, tree, filePath,
        '(class_definition name: (identifier) @name)',
        AuraNodeKind.Class,
        symbols, contains, seenIds, new Set(),
      )

      // Python convention: names not starting with _ are public
      for (const symbol of symbols) {
        if (symbol.kind === AuraNodeKind.Class) {
          symbol.exported = !symbol.name.startsWith('_') ||
            (symbol.name.startsWith('__') && symbol.name.endsWith('__'))
        }
      }

      // Extract functions and methods — walk tree to determine parent context
      this.extractPythonFunctions(tree, filePath, symbols, contains, seenIds)

      // Extract module-level assignments as variables
      this.extractPythonVariables(tree, filePath, symbols, contains, seenIds)

      // Extract imports
      this.extractPythonImports(language, tree, filePath, imports)

      // Extract calls
      this.extractPythonCalls(language, tree, filePath, calls, symbols)

      // Extract heritage (inheritance)
      this.extractPythonHeritage(language, tree, filePath, heritage)

      // Extract data flow
      const dataFlowEdges = this.dataFlowAnalyzer.analyze(language, tree, filePath, symbols, calls)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: dataFlowEdges }
    } finally {
      tree.delete()
    }
  }

  private extractPythonFunctions(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const stack: SyntaxNode[] = [tree.rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name')
        if (!nameNode) continue
        const name = nameNode.text
        const symbolId = `${filePath}:${name}`
        if (seenIds.has(symbolId)) continue
        seenIds.add(symbolId)

        // Determine if this is a method (inside a class) or a function (module-level)
        const isMethod = node.parent?.type === 'class_definition' ||
          this.isInsideClass(node)
        const kind = isMethod ? AuraNodeKind.Method : AuraNodeKind.Function

        // Python convention: names not starting with _ are "exported" (public)
        const exported = !name.startsWith('_') || (name.startsWith('__') && name.endsWith('__'))

        // Extract decorators
        const decorators: string[] = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child?.type === 'decorator') {
            decorators.push(child.text)
          }
        }

        symbols.push({
          id: symbolId,
          kind,
          name,
          filePath,
          range: {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          },
          exported,
          metadata: decorators.length > 0 ? { decorators } : undefined,
        })

        contains.push({
          source: filePath,
          target: symbolId,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }

      for (let i = node.childCount - 1; i >= 0; i--) {
        stack.push(node.child(i)!)
      }
    }
  }

  private isInsideClass(node: SyntaxNode): boolean {
    let current = node.parent
    while (current) {
      if (current.type === 'class_definition') return true
      current = current.parent
    }
    return false
  }

  private extractPythonVariables(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    // Only module-level assignments (direct children of module)
    const root = tree.rootNode
    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i)
      if (!child || child.type !== 'expression_statement') continue

      for (let j = 0; j < child.childCount; j++) {
        const stmt = child.child(j)
        if (!stmt || stmt.type !== 'assignment') continue

        const left = stmt.childForFieldName('left')
        if (!left || left.type !== 'identifier') continue

        const name = left.text
        // Skip private/dunder assignments
        if (name.startsWith('__') && name.endsWith('__')) continue
        if (name.startsWith('_') && !name.startsWith('__')) continue

        const symbolId = `${filePath}:${name}`
        if (seenIds.has(symbolId)) continue
        seenIds.add(symbolId)

        symbols.push({
          id: symbolId,
          kind: AuraNodeKind.Variable,
          name,
          filePath,
          range: {
            startLine: stmt.startPosition.row + 1,
            endLine: stmt.endPosition.row + 1,
          },
          exported: true,
        })

        contains.push({
          source: filePath,
          target: symbolId,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }
    }
  }

  private extractPythonImports(
    language: Language,
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    // Pattern 1: import X
    let query: Query | null = null
    try {
      query = new Query(language, '(import_statement) @import_stmt')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'import_stmt') continue
        // import X, Y, Z or import X as Y
        const importedSymbols: Array<{ localName: string; exportedName: string }> = []
        let modulePath = ''

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue

          if (child.type === 'dotted_name' || child.type === 'identifier') {
            modulePath = child.text
            importedSymbols.push({
              localName: child.text.split('.').pop()!,
              exportedName: child.text,
            })
          } else if (child.type === 'aliased_import') {
            const nameNode = child.childForFieldName('name')
            const aliasNode = child.childForFieldName('alias')
            if (nameNode) {
              modulePath = nameNode.text
              importedSymbols.push({
                localName: aliasNode?.text ?? nameNode.text,
                exportedName: nameNode.text,
              })
            }
          }
        }

        if (modulePath) {
          imports.push({
            source: filePath,
            target: modulePath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: {
              rawImportPath: modulePath,
              ...(importedSymbols.length > 0 && { importedSymbols }),
            },
          })
        }
      }
    } finally {
      query.delete()
    }

    // Pattern 2: from X import Y
    try {
      query = new Query(language, '(import_from_statement) @import_from')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'import_from') continue

        // Extract module name (from X import ...) and imported symbols
        let modulePath = ''
        const importedSymbols: Array<{ localName: string; exportedName: string }> = []
        let pastImport = false // Track if we've passed the 'import' keyword

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue

          if (child.type === 'import') {
            pastImport = true
            continue
          }

          if (!pastImport) {
            // Before 'import' keyword: this is the module path
            if (child.type === 'dotted_name' && !modulePath) {
              modulePath = child.text
            } else if (child.type === 'relative_import') {
              // from .module import Y — relative_import contains the dots and module name
              modulePath = child.text
            }
          } else {
            // After 'import' keyword: these are the imported names
            if (child.type === 'dotted_name' || child.type === 'identifier') {
              const symName = child.type === 'dotted_name'
                ? child.text.split('.').pop()!
                : child.text
              importedSymbols.push({ localName: symName, exportedName: child.text })
            } else if (child.type === 'aliased_import') {
              const nameNode = child.childForFieldName('name')
              const aliasNode = child.childForFieldName('alias')
              if (nameNode) {
                importedSymbols.push({
                  localName: aliasNode?.text ?? nameNode.text,
                  exportedName: nameNode.text,
                })
              }
            } else if (child.type === 'wildcard_import') {
              importedSymbols.push({ localName: '*', exportedName: '*' })
            } else if (child.type === 'import_from_clause') {
              this.extractPythonImportNames(child, importedSymbols)
            }
          }
        }

        if (modulePath) {
          imports.push({
            source: filePath,
            target: modulePath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: {
              rawImportPath: modulePath,
              ...(importedSymbols.length > 0 && { importedSymbols }),
            },
          })
        }
      }
    } finally {
      query.delete()
    }
  }

  private extractPythonImportNames(
    node: SyntaxNode,
    names: Array<{ localName: string; exportedName: string }>,
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === 'identifier') {
        names.push({ localName: child.text, exportedName: child.text })
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name')
        const aliasNode = child.childForFieldName('alias')
        if (nameNode) {
          names.push({
            localName: aliasNode?.text ?? nameNode.text,
            exportedName: nameNode.text,
          })
        }
      } else if (child.type === 'dotted_name') {
        // from X import Y.Z — take the last segment
        const name = child.text.split('.').pop()!
        names.push({ localName: name, exportedName: child.text })
      } else if (child.type === 'wildcard_import') {
        // from X import * — no specific names
        names.push({ localName: '*', exportedName: '*' })
      }
    }
  }

  private extractPythonCalls(
    language: Language,
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    // Direct calls: func_name(args)
    let query: Query | null = null
    try {
      query = new Query(language, '(call function: (identifier) @name)')
    } catch {
      return
    }

    const seenCalls = new Set<string>()

    try {
      const captures = query.captures(tree.rootNode)
      for (const { node } of captures) {
        const callName = node.text
        if (PY_BUILTINS.has(callName)) continue

        // Skip calls inside decorators (they're route registrations, not business logic)
        if (this.isInsideDecorator(node as unknown as SyntaxNode)) continue

        const enclosingSymbol = this.findEnclosingSymbol(node as unknown as { parent: { type: string; parent: unknown } | null }, symbols)
        const source = enclosingSymbol ? enclosingSymbol.id : filePath

        const dedupeKey = `${source}→${callName}`
        if (seenCalls.has(dedupeKey)) continue
        seenCalls.add(dedupeKey)

        calls.push({
          source,
          target: callName,
          type: AuraEdgeType.CALLS,
          confidence: 0.7,
          metadata: { callName, callTargetKind: 'direct' },
        })
      }
    } finally {
      query.delete()
    }

    // Attribute calls: obj.method(args) — Python uses 'attribute' instead of 'member_expression'
    try {
      query = new Query(language, '(call function: (attribute) @attr)')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { node } of captures) {
        const objNode = node.childForFieldName('object')
        const attrNode = node.childForFieldName('attribute')
        if (!objNode || !attrNode) continue

        const methodName = attrNode.text
        if (PY_BUILTINS.has(methodName)) continue

        // Skip calls inside decorators (they're route registrations, not business logic)
        if (this.isInsideDecorator(node as unknown as SyntaxNode)) continue

        const callName = `${objNode.text}.${methodName}`
        const enclosingSymbol = this.findEnclosingSymbol(
          node as unknown as { parent: { type: string; parent: unknown } | null },
          symbols,
        )
        const source = enclosingSymbol ? enclosingSymbol.id : filePath

        const dedupeKey = `${source}→${callName}`
        if (seenCalls.has(dedupeKey)) continue
        seenCalls.add(dedupeKey)

        calls.push({
          source,
          target: callName,
          type: AuraEdgeType.CALLS,
          confidence: 0.5,
          metadata: { callName, callTargetKind: 'member', methodName },
        })
      }
    } finally {
      query.delete()
    }
  }

  private extractPythonHeritage(
    language: Language,
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    // class Child(Parent) — single or multiple inheritance
    let query: Query | null = null
    try {
      query = new Query(language, '(class_definition superclasses: (argument_list (identifier) @parent))')
    } catch {
      // Try alternative: single parent without argument_list
      try {
        query = new Query(language, '(class_definition superclasses: (identifier) @parent)')
      } catch {
        return
      }
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'parent') continue

        const parentName = node.text
        const className = this.findEnclosingClassName(node as unknown as { parent: { type: string; parent: unknown } | null })
        const source = className ? `${filePath}:${className}` : filePath

        heritage.push({
          source,
          target: parentName,
          type: AuraEdgeType.EXTENDS,
          confidence: 0.9,
          metadata: { rawTargetName: parentName },
        })
      }
    } finally {
      query?.delete()
    }
  }

  // ── CSS parsing ────────────────────────────────────────────────────────────

  private parseCssFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractCssImports(tree, filePath, imports)
      this.extractCssSelectors(language, tree, filePath, symbols, contains, seenIds)
      this.extractCssAtRules(language, tree, filePath, symbols, contains, seenIds)
      this.extractCssCustomProperties(tree, filePath, symbols, contains, seenIds)

      return { filePath, symbols, imports, calls: [], heritage: [], contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractCssImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    // @import url("...") or @import "..."
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'import_statement') {
        let importPath = ''
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          // @import "path" — tree-sitter-css uses string_value containing string_content
          if (child.type === 'string_value' || child.type === 'string') {
            importPath = this.extractStringContent(child)
          } else if (child.type === 'call_expression') {
            // @import url("path") — extract from url() arguments
            for (let j = 0; j < child.childCount; j++) {
              const arg = child.child(j)!
              if (arg.type === 'arguments') {
                for (let k = 0; k < arg.childCount; k++) {
                  const param = arg.child(k)!
                  if (param.type === 'string_value' || param.type === 'string') {
                    importPath = this.extractStringContent(param)
                  }
                }
              }
            }
          }
        }
        if (importPath) {
          imports.push({
            source: filePath,
            target: importPath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: { rawImportPath: importPath, importKind: 'css-import' },
          })
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  /**
   * Extract text content from a string-like node.
   * Handles both `string` nodes (strip surrounding quotes) and `string_value`
   * nodes (which contain `string_content` children in tree-sitter-css/scss).
   */
  private extractStringContent(node: SyntaxNode): string {
    // string_value nodes in tree-sitter-css/scss have string_content children
    if (node.type === 'string_value') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)!
        if (child.type === 'string_content') {
          return child.text
        }
      }
      // Fallback: if no string_content child, the node text might just be the content
      // Strip surrounding quotes if present
      const text = node.text
      if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1)
      }
      return text
    }
    // Plain string node: strip surrounding quotes
    const text = node.text
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1)
    }
    return text
  }

  private extractCssSelectors(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    // Extract selectors from rule sets
    let query: Query | null = null
    try {
      query = new Query(language, '(rule_set (selectors) @selectors)')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'selectors') continue

        // The selectors node text is the full selector string (e.g. ".my-class, #my-id")
        const selectorText = node.text.trim()
        // Split on comma for multiple selectors
        const individualSelectors = selectorText.split(',').map(s => s.trim()).filter(Boolean)

        for (const sel of individualSelectors) {
          const symbolId = `${filePath}:${sel}`
          if (seenIds.has(symbolId)) continue
          seenIds.add(symbolId)

          symbols.push({
            id: symbolId,
            kind: AuraNodeKind.Selector,
            name: sel,
            filePath,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            },
            exported: true, // CSS selectors are globally visible
          })

          contains.push({
            source: filePath,
            target: symbolId,
            type: AuraEdgeType.CONTAINS,
            confidence: 1.0,
          })
        }
      }
    } finally {
      query.delete()
    }
  }

  private extractCssAtRules(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    // Extract at-rules using both tree-walk (for media_statement, keyframes_statement)
    // and query (for generic at_rule like @font-face)
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'media_statement' || node.type === 'keyframes_statement' || node.type === 'at_rule') {
        const firstChild = node.child(0)
        if (firstChild) {
          const atKeyword = firstChild.text
          // Skip @charset and @import (handled by extractCssImports)
          if (atKeyword === '@charset' || atKeyword === '@import') {
            // skip, but continue walking children
          } else {
            // Try to extract the name (e.g. @keyframes fadeIn, @media (max-width: 768px))
            let atRuleName = atKeyword
            for (let i = 1; i < node.childCount; i++) {
              const child = node.child(i)!
              if (child.type === 'identifier' || child.type === 'keyframes_name') {
                atRuleName = `${atKeyword} ${child.text}`
                break
              }
              // @media uses feature_query for the condition
              if (child.type === 'feature_query' || child.type === 'parenthesized_query' || child.type === 'block') {
                atRuleName = `${atKeyword} ${child.text}`
                break
              }
            }

            const symbolId = `${filePath}:${atRuleName}`
            if (!seenIds.has(symbolId)) {
              seenIds.add(symbolId)

              symbols.push({
                id: symbolId,
                kind: AuraNodeKind.AtRule,
                name: atRuleName,
                filePath,
                range: {
                  startLine: node.startPosition.row + 1,
                  endLine: node.endPosition.row + 1,
                },
                exported: false,
              })

              contains.push({
                source: filePath,
                target: symbolId,
                type: AuraEdgeType.CONTAINS,
                confidence: 1.0,
              })
            }
          }
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCssCustomProperties(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    // --my-variable: value
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'declaration') {
        // First child is typically the property name
        const propNode = node.child(0)
        if (propNode && propNode.text.startsWith('--')) {
          const propName = propNode.text
          const symbolId = `${filePath}:${propName}`
          if (seenIds.has(symbolId)) return
          seenIds.add(symbolId)

          symbols.push({
            id: symbolId,
            kind: AuraNodeKind.CustomProperty,
            name: propName,
            filePath,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            },
            exported: true,
          })

          contains.push({
            source: filePath,
            target: symbolId,
            type: AuraEdgeType.CONTAINS,
            confidence: 1.0,
          })
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  // ── SCSS parsing ────────────────────────────────────────────────────────────

  private parseScssFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      // CSS-base extractions (selectors, @import, at-rules, custom properties)
      this.extractCssImports(tree, filePath, imports)
      this.extractCssSelectors(language, tree, filePath, symbols, contains, seenIds)
      this.extractCssAtRules(language, tree, filePath, symbols, contains, seenIds)
      this.extractCssCustomProperties(tree, filePath, symbols, contains, seenIds)

      // SCSS-specific extractions
      this.extractScssUseForward(tree, filePath, imports)
      this.extractScssMixins(language, tree, filePath, symbols, contains, seenIds)
      this.extractScssFunctions(language, tree, filePath, symbols, contains, seenIds)
      this.extractScssVariables(tree, filePath, symbols, contains, seenIds)
      this.extractScssIncludes(tree, filePath, calls)
      this.extractScssExtends(tree, filePath, heritage)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractScssUseForward(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // @use "path" and @forward "path"
      if (node.type === 'use_statement' || node.type === 'forward_statement') {
        let importPath = ''
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'string_value' || child.type === 'string') {
            importPath = this.extractStringContent(child)
          }
        }
        // Fallback: if no string_value child found, try extracting from node text
        // This handles cases where tree-sitter-scss produces ERROR nodes (e.g. @use ... as)
        if (!importPath) {
          const textMatch = node.text.match(/@(?:use|forward)\s+['"]([^'"]+)['"]/)
          if (textMatch) {
            importPath = textMatch[1]
          }
        }
        if (importPath) {
          const kind = node.type === 'use_statement' ? 'use' : 'forward'
          imports.push({
            source: filePath,
            target: importPath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: { rawImportPath: importPath, importKind: kind },
          })
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractScssMixins(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, '(mixin_statement (identifier) @name)')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'name') continue
        const mixinName = node.text
        const symbolId = `${filePath}:${mixinName}`
        if (seenIds.has(symbolId)) continue
        seenIds.add(symbolId)

        symbols.push({
          id: symbolId,
          kind: AuraNodeKind.Mixin,
          name: mixinName,
          filePath,
          range: {
            startLine: (node.parent ?? node).startPosition.row + 1,
            endLine: (node.parent ?? node).endPosition.row + 1,
          },
          exported: true,
        })

        contains.push({
          source: filePath,
          target: symbolId,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }
    } finally {
      query.delete()
    }
  }

  private extractScssFunctions(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, '(function_statement (identifier) @name)')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'name') continue
        const funcName = node.text
        const symbolId = `${filePath}:${funcName}`
        if (seenIds.has(symbolId)) continue
        seenIds.add(symbolId)

        symbols.push({
          id: symbolId,
          kind: AuraNodeKind.ScssFunction,
          name: funcName,
          filePath,
          range: {
            startLine: (node.parent ?? node).startPosition.row + 1,
            endLine: (node.parent ?? node).endPosition.row + 1,
          },
          exported: true,
        })

        contains.push({
          source: filePath,
          target: symbolId,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }
    } finally {
      query.delete()
    }
  }

  private extractScssVariables(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    // In tree-sitter-scss, $variable declarations appear as `declaration` nodes
    // where the property_name starts with $. E.g. "$font-stack: sans-serif;" →
    // declaration { property_name: "$font-stack", ... }
    const walk = (node: SyntaxNode, depth: number): void => {
      if (node.type === 'declaration') {
        const propNode = node.child(0)
        if (propNode && propNode.type === 'property_name' && propNode.text.startsWith('$')) {
          const varName = propNode.text
          const symbolId = `${filePath}:${varName}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)

            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.ScssVariable,
              name: varName,
              filePath,
              range: {
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
              },
              // Top-level variables (depth 1) are effectively "exported"
              exported: depth <= 1 && !varName.startsWith('$_'),
            })

            contains.push({
              source: filePath,
              target: symbolId,
              type: AuraEdgeType.CONTAINS,
              confidence: 1.0,
            })
          }
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!, depth + 1)
      }
    }
    walk(tree.rootNode, 0)
  }

  private extractScssIncludes(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
  ): void {
    // @include mixinName or @include mixinName(args)
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'include_statement') {
        let mixinName = ''
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'identifier') {
            mixinName = child.text
            break
          }
        }
        if (mixinName) {
          calls.push({
            source: filePath,
            target: mixinName,
            type: AuraEdgeType.CALLS,
            confidence: 0.8,
            metadata: { callName: mixinName, callTargetKind: 'mixin-include' },
          })
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractScssExtends(
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    // @extend .selector or %placeholder
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'extend_statement') {
        let targetName = ''
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          // The selector being extended (class, id, or placeholder)
          if (child.type === 'selector' || child.type === 'class_selector' ||
              child.type === 'id_selector' || child.type === 'placeholder_selector' ||
              child.type === 'identifier') {
            targetName = child.text
            break
          }
        }
        if (!targetName) {
          // Fallback: use the text content after @extend
          const text = node.text.replace('@extend', '').trim().replace(/;$/, '')
          targetName = text
        }
        if (targetName) {
          heritage.push({
            source: filePath,
            target: targetName,
            type: AuraEdgeType.EXTENDS,
            confidence: 0.8,
            metadata: { rawTargetName: targetName, extendKind: 'scss-extend' },
          })
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  // ── PHP parsing ─────────────────────────────────────────────────────────────

  private parsePhpFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractPhpDeclarations(tree, filePath, symbols, contains, seenIds)
      this.extractPhpImports(tree, filePath, imports)
      this.extractPhpCalls(tree, filePath, calls, symbols)
      this.extractPhpHeritage(tree, filePath, heritage)

      // Data flow for PHP
      const dataFlowEdges = this.dataFlowAnalyzer.analyze(language, tree, filePath, symbols, calls)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: dataFlowEdges }
    } finally {
      tree.delete()
    }
  }

  private extractPhpDeclarations(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Class declarations
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Class,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Interface declarations
      if (node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Interface,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Trait declarations
      if (node.type === 'trait_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Trait,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Enum declarations
      if (node.type === 'enum_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Enum,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Function definitions (not inside classes — those are methods)
      if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const isMethod = this.isPhpInsideClass(node)
          const kind = isMethod ? AuraNodeKind.Method : AuraNodeKind.Function
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)

            const modifiers = this.extractPhpModifiers(node)

            symbols.push({
              id: symbolId,
              kind,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: !name.startsWith('_'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Method declarations (explicit "function" keyword inside class body)
      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)

            const modifiers = this.extractPhpModifiers(node)

            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Method,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: !name.startsWith('_'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractPhpModifiers(node: SyntaxNode): string[] {
    const modifiers: string[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'visibility_modifier' || child.type === 'static_modifier' ||
          child.type === 'abstract_modifier' || child.type === 'final_modifier') {
        modifiers.push(child.text)
      }
    }
    return modifiers
  }

  private isPhpInsideClass(node: SyntaxNode): boolean {
    let current = node.parent
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'interface_declaration' ||
          current.type === 'trait_declaration' || current.type === 'enum_declaration') {
        return true
      }
      current = current.parent
    }
    return false
  }

  private extractPhpImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // use statements: use Some\Namespace\Class; use Some\Namespace\Class as Alias;
      // In tree-sitter-php, these are 'namespace_use_declaration' nodes containing
      // 'namespace_use_clause' with a 'qualified_name' child.
      if (node.type === 'use_declaration' || node.type === 'namespace_use_declaration') {
        let importPath = ''
        let importKind = 'use'

        // Look for namespace_use_clause → qualified_name (full path)
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'namespace_use_clause') {
            // The qualified_name child has the full path like "App\Interfaces\RenderableInterface"
            for (let j = 0; j < child.childCount; j++) {
              const clauseChild = child.child(j)!
              if (clauseChild.type === 'qualified_name') {
                importPath = clauseChild.text.replace(/\\/g, '/')
              }
              // Also check for 'name' (simple class name like "Timestampable")
              if (!importPath && clauseChild.type === 'name') {
                importPath = clauseChild.text
              }
            }
          }
          // Check for 'function' or 'const' keyword in use declarations
          if (child.type === 'function' || child.type === 'const') {
            importKind = child.type === 'function' ? 'use-function' : 'use-const'
          }
          // For simple use declarations (trait use inside classes), 'name' child
          if (!importPath && (child.type === 'name' || child.type === 'namespace_name')) {
            importPath = child.text.replace(/\\/g, '/')
          }
          // qualified_name directly on the use_declaration node
          if (!importPath && child.type === 'qualified_name') {
            importPath = child.text.replace(/\\/g, '/')
          }
        }

        // Fallback: extract from node text using regex
        if (!importPath) {
          const textMatch = node.text.match(/^use\s+([^;]+);?$/)
          if (textMatch) {
            importPath = textMatch[1].replace(/\s+as\s+\w+$/, '').trim().replace(/\\/g, '/')
          }
        }

        if (importPath) {
          // Check for 'as' alias
          let alias = ''
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!
            if (child.type === 'alias') {
              alias = child.text
            }
          }
          if (!alias) {
            for (let i = 0; i < node.childCount - 1; i++) {
              if (node.child(i)!.text === 'as' && node.child(i + 1)) {
                alias = node.child(i + 1)!.text
              }
            }
          }

          imports.push({
            source: filePath,
            target: importPath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: {
              rawImportPath: importPath,
              importKind,
              ...(alias && { alias }),
            },
          })
        }
      }

      // require/include statements: require_once 'file.php'; include 'path/to/file.php';
      // In tree-sitter-php, these are require_expression, require_once_expression, etc.
      if (node.type === 'require_expression' || node.type === 'include_expression' ||
          node.type === 'require_once_expression' || node.type === 'include_once_expression') {
        let importPath = ''

        // Extract path from direct string child: require_once '/path/file.php';
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'string') {
            importPath = this.extractPhpStringContent(child)
          }
        }

        // Handle concatenation expressions: require_once __DIR__ . '/file.php';
        // These appear as binary_expression nodes
        if (!importPath) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!
            if (child.type === 'binary_expression') {
              // Find the string literal in the binary expression (the right-hand side)
              for (let j = 0; j < child.childCount; j++) {
                const operand = child.child(j)!
                if (operand.type === 'string') {
                  const extracted = this.extractPhpStringContent(operand)
                  if (extracted) {
                    importPath = extracted
                    break
                  }
                }
              }
            }
          }
        }

        // Handle parenthesized expressions: require_once("file.php")
        if (!importPath) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!
            if (child.type === 'parenthesized_expression') {
              for (let j = 0; j < child.childCount; j++) {
                const inner = child.child(j)!
                if (inner.type === 'string') {
                  importPath = this.extractPhpStringContent(inner)
                } else if (inner.type === 'binary_expression') {
                  for (let k = 0; k < inner.childCount; k++) {
                    const operand = inner.child(k)!
                    if (operand.type === 'string') {
                      importPath = this.extractPhpStringContent(operand)
                    }
                  }
                }
              }
            }
          }
        }

        if (importPath) {
          const kind = node.type.startsWith('require') ? 'require' : 'include'
          imports.push({
            source: filePath,
            target: importPath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: { rawImportPath: importPath, importKind: kind },
          })
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  /** Extract string content from PHP string nodes (which have string_content children) */
  private extractPhpStringContent(node: SyntaxNode): string {
    // PHP strings have structure: string → ' / " + string_content + ' / "
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'string_content') {
        return child.text
      }
    }
    // Fallback: strip quotes from node text
    const text = node.text
    if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
      return text.slice(1, -1)
    }
    return text
  }

  private extractPhpCalls(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    const seenCalls = new Set<string>()

    const walk = (node: SyntaxNode): void => {
      // Function calls: function_name(args)
      if (node.type === 'function_call_expression') {
        const funcNameNode = node.childForFieldName('function')
        let callName = funcNameNode?.text ?? ''
        if (!callName) {
          const firstChild = node.child(0)
          if (firstChild && firstChild.type !== '(' && firstChild.type !== 'argument_list') {
            callName = firstChild.text
          }
        }

        if (callName && !this.isPhpBuiltin(callName)) {
          const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
          const source = enclosingSymbol ? enclosingSymbol.id : filePath
          const dedupeKey = `${source}→${callName}`
          if (!seenCalls.has(dedupeKey)) {
            seenCalls.add(dedupeKey)
            calls.push({
              source,
              target: callName,
              type: AuraEdgeType.CALLS,
              confidence: 0.7,
              metadata: { callName, callTargetKind: 'direct' },
            })
          }
        }
      }

      // Method calls: $obj->method(args) or ClassName::method(args)
      // tree-sitter-php uses 'member_call_expression' for -> calls and 'scoped_call_expression' for :: calls
      if (node.type === 'method_call_expression' || node.type === 'member_call_expression' || node.type === 'scoped_call_expression') {
        let callName = ''
        let objName = ''

        if (node.type === 'method_call_expression' || node.type === 'member_call_expression') {
          const methodNode = node.childForFieldName('method')
            ?? node.childForFieldName('name')  // 'member_call_expression' uses 'name' field
          const objectNode = node.childForFieldName('object')
            ?? node.childForFieldName('scope')  // fallback
          callName = methodNode?.text ?? ''
          objName = objectNode?.text ?? ''
        } else {
          const nameNode = node.childForFieldName('name')
          const scopeNode = node.childForFieldName('scope')
          callName = nameNode?.text ?? ''
          objName = scopeNode?.text ?? ''
        }

        if (callName && !this.isPhpBuiltin(callName)) {
          const fullCall = objName ? `${objName}->${callName}` : callName
          const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
          const source = enclosingSymbol ? enclosingSymbol.id : filePath
          const dedupeKey = `${source}→${fullCall}`
          if (!seenCalls.has(dedupeKey)) {
            seenCalls.add(dedupeKey)
            calls.push({
              source,
              target: fullCall,
              type: AuraEdgeType.CALLS,
              confidence: 0.5,
              metadata: { callName: fullCall, callTargetKind: 'member', methodName: callName },
            })
          }
        }
      }

      // Object creation: new ClassName()
      if (node.type === 'object_creation_expression') {
        let className = ''
        // In tree-sitter-php, the class name can be a 'name' or 'qualified_name' child
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'name' || child.type === 'qualified_name' || child.type === 'namespace_name') {
            className = child.text.replace(/\\/g, '/')
            break
          }
        }
        // Also try field name
        if (!className) {
          const classNode = node.childForFieldName('class')
          if (classNode) className = classNode.text.replace(/\\/g, '/')
        }

        if (className && !this.isPhpBuiltin(className)) {
          const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
          const source = enclosingSymbol ? enclosingSymbol.id : filePath
          const dedupeKey = `${source}→new:${className}`
          if (!seenCalls.has(dedupeKey)) {
            seenCalls.add(dedupeKey)
            calls.push({
              source,
              target: className,
              type: AuraEdgeType.CALLS,
              confidence: 0.8,
              metadata: { callName: `new ${className}`, callTargetKind: 'constructor' },
            })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private isPhpBuiltin(name: string): boolean {
    const builtins = new Set([
      'echo', 'print', 'isset', 'unset', 'empty', 'die', 'exit',
      'var_dump', 'print_r', 'array', 'list', 'compact', 'extract',
      'count', 'sizeof', 'strlen', 'substr', 'strpos', 'str_replace',
      'strtolower', 'strtoupper', 'trim', 'rtrim', 'ltrim',
      'implode', 'explode', 'split', 'preg_match', 'preg_replace',
      'json_encode', 'json_decode', 'serialize', 'unserialize',
      'intval', 'floatval', 'strval', 'boolval', 'settype', 'gettype',
      'is_array', 'is_string', 'is_int', 'is_float', 'is_bool', 'is_null', 'is_object',
      'array_push', 'array_pop', 'array_shift', 'array_unshift', 'array_merge',
      'array_map', 'array_filter', 'array_keys', 'array_values', 'array_flip',
      'in_array', 'array_key_exists', 'array_search',
      'sort', 'usort', 'asort', 'ksort',
      'header', 'http_response_code', 'setcookie',
      'file_get_contents', 'file_put_contents', 'fopen', 'fclose', 'fread', 'fwrite',
      'file_exists', 'is_file', 'is_dir', 'mkdir', 'rmdir', 'unlink',
      'basename', 'dirname', 'pathinfo', 'realpath',
      'sprintf', 'printf', 'fprintf', 'vprintf',
      'abs', 'ceil', 'floor', 'round', 'max', 'min', 'rand', 'mt_rand',
      'date', 'time', 'strtotime', 'mktime', 'date_create',
      'curl_init', 'curl_exec', 'curl_close',
      'mysqli_connect', 'mysqli_query', 'PDO', 'pdo',
      'parent', 'self', 'static', 'true', 'false', 'null',
      'array_values', 'array_slice', 'array_splice', 'array_reverse',
      'call_user_func', 'call_user_func_array', 'func_get_args',
      'trigger_error', 'set_error_handler', 'error_reporting',
      'ob_start', 'ob_end_clean', 'ob_get_clean', 'ob_get_contents',
      'session_start', 'session_destroy', 'session_id',
      'htmlspecialchars', 'htmlentities', 'strip_tags', 'urlencode', 'urldecode',
      // Common PHP framework functions
      'app', 'env', 'config', 'route', 'middleware', 'dispatch',
      'response', 'request', 'redirect', 'view', 'validate',
    ])
    return builtins.has(name) || name.startsWith('\\')
  }

  private extractPhpHeritage(
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'class_declaration' || node.type === 'enum_declaration') {
        const classNameNode = node.childForFieldName('name')
        const className = classNameNode?.text ?? ''
        const source = className ? `${filePath}:${className}` : filePath

        // extends ClassName — in tree-sitter-php, this is a 'base_clause' node
        // containing 'extends' keyword + 'name' child
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'base_clause') {
            for (let j = 0; j < child.childCount; j++) {
              const baseChild = child.child(j)!
              if (baseChild.type === 'name' || baseChild.type === 'qualified_name' || baseChild.type === 'namespace_name') {
                heritage.push({
                  source,
                  target: baseChild.text.replace(/\\/g, '/'),
                  type: AuraEdgeType.EXTENDS,
                  confidence: 0.9,
                  metadata: { rawTargetName: baseChild.text, heritageKind: 'extends' },
                })
              }
            }
          }
        }

        // implements Interface1, Interface2 — class_interface_clause node
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'class_interface_clause') {
            for (let j = 0; j < child.childCount; j++) {
              const ifaceChild = child.child(j)!
              if (ifaceChild.type === 'name' || ifaceChild.type === 'qualified_name' || ifaceChild.type === 'namespace_name') {
                heritage.push({
                  source,
                  target: ifaceChild.text.replace(/\\/g, '/'),
                  type: AuraEdgeType.IMPLEMENTS,
                  confidence: 0.9,
                  metadata: { rawTargetName: ifaceChild.text, heritageKind: 'implements' },
                })
              }
            }
          }
        }
      }

      // Interface extends other interfaces — also uses 'base_clause' in tree-sitter-php
      if (node.type === 'interface_declaration') {
        const interfaceNameNode = node.childForFieldName('name')
        const interfaceName = interfaceNameNode?.text ?? ''
        const source = interfaceName ? `${filePath}:${interfaceName}` : filePath

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          // In tree-sitter-php, interface extends uses 'base_clause' (same as class extends)
          if (child.type === 'base_clause') {
            for (let j = 0; j < child.childCount; j++) {
              const baseChild = child.child(j)!
              if (baseChild.type === 'name' || baseChild.type === 'qualified_name' || baseChild.type === 'namespace_name') {
                heritage.push({
                  source,
                  target: baseChild.text.replace(/\\/g, '/'),
                  type: AuraEdgeType.EXTENDS,
                  confidence: 0.9,
                  metadata: { rawTargetName: baseChild.text, heritageKind: 'interface-extends' },
                })
              }
            }
          }
        }
      }

      // use Trait — inside class body (trait use, not namespace use)
      // In tree-sitter-php, trait use inside a class is 'use_declaration' with parent 'declaration_list'
      if (node.type === 'use_declaration') {
        // Only process trait use inside class-like declarations, not namespace use declarations
        const parentType = node.parent?.type
        if (parentType === 'declaration_list') {
          // Walk up to find the class/interface/trait/enum declaration
          let classNode: SyntaxNode | null = node.parent?.parent ?? null
          let className = ''
          while (classNode) {
            if (classNode.type === 'class_declaration' || classNode.type === 'trait_declaration' ||
                classNode.type === 'enum_declaration' || classNode.type === 'interface_declaration') {
              const nameNode = classNode.childForFieldName('name')
              if (nameNode) className = nameNode.text
              break
            }
            classNode = classNode.parent
          }

          const source = className ? `${filePath}:${className}` : filePath

          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!
            if (child.type === 'name' || child.type === 'qualified_name' || child.type === 'namespace_name') {
              heritage.push({
                source,
                target: child.text.replace(/\\/g, '/'),
                type: AuraEdgeType.IMPLEMENTS,
                confidence: 0.8,
                metadata: { rawTargetName: child.text, heritageKind: 'use-trait' },
              })
            }
          }
        }
      }

      // Also handle 'trait_use_clause' (tree-sitter-php alternative node for trait use)
      if (node.type === 'trait_use_clause') {
        let className = ''
        let classNode: SyntaxNode | null = node.parent
        while (classNode) {
          if (classNode.type === 'class_declaration' || classNode.type === 'trait_declaration' ||
              classNode.type === 'enum_declaration' || classNode.type === 'interface_declaration') {
            const nameNode = classNode.childForFieldName('name')
            if (nameNode) className = nameNode.text
            break
          }
          classNode = classNode.parent
        }

        const source = className ? `${filePath}:${className}` : filePath

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'name' || child.type === 'qualified_name' || child.type === 'namespace_name') {
            heritage.push({
              source,
              target: child.text.replace(/\\/g, '/'),
              type: AuraEdgeType.IMPLEMENTS,
              confidence: 0.8,
              metadata: { rawTargetName: child.text, heritageKind: 'use-trait' },
            })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private findEnclosingSymbolFromTree(
    node: SyntaxNode,
    symbols: AuraNode[],
    filePath: string,
  ): AuraNode | null {
    let current: SyntaxNode | null = node
    while (current) {
      if (current.type === 'function_definition' || current.type === 'method_declaration' ||
          current.type === 'class_declaration' || current.type === 'interface_declaration' ||
          current.type === 'trait_declaration' || current.type === 'enum_declaration') {
        const nameNode = current.childForFieldName('name')
        if (nameNode) {
          const match = symbols.find(s => s.name === nameNode.text && s.filePath === filePath)
          if (match) return match
        }
      }
      current = current.parent
    }
    return null
  }

  // ── Java parsing ────────────────────────────────────────────────────────────

  private parseJavaFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractJavaDeclarations(tree, filePath, symbols, contains, seenIds)
      this.extractJavaImports(tree, filePath, imports)
      this.extractJavaCalls(tree, filePath, calls, symbols)
      this.extractJavaHeritage(tree, filePath, heritage)

      // Data flow for Java
      const dataFlowEdges = this.dataFlowAnalyzer.analyze(language, tree, filePath, symbols, calls)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: dataFlowEdges }
    } finally {
      tree.delete()
    }
  }

  private extractJavaDeclarations(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Class declarations — tree-sitter-java uses 'identifier' for the name field
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name')
        // Fallback: tree-sitter-java uses 'identifier' for names
        const name = nameNode?.text ?? this.findChildByText(node, 'identifier')
        if (name) {
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractJavaModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Class,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Interface declarations
      if (node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text ?? this.findChildByText(node, 'identifier')
        if (name) {
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractJavaModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Interface,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Enum declarations
      if (node.type === 'enum_declaration') {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text ?? this.findChildByText(node, 'identifier')
        if (name) {
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractJavaModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Enum,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Method declarations — tree-sitter-java uses 'identifier' for the name
      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text ?? this.findChildByText(node, 'identifier')
        if (name) {
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractJavaModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Method,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Field declarations (class-level variables)
      if (node.type === 'field_declaration') {
        const declaratorNode = node.childForFieldName('declarator')
        if (declaratorNode) {
          const varNameNode = declaratorNode.childForFieldName('name')
          const name = varNameNode?.text ?? this.findChildByText(declaratorNode, 'identifier')
          if (name) {
            const symbolId = `${filePath}:${name}`
            if (!seenIds.has(symbolId)) {
              seenIds.add(symbolId)
              const modifiers = this.extractJavaModifiers(node)
              symbols.push({
                id: symbolId,
                kind: AuraNodeKind.Variable,
                name,
                filePath,
                range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                exported: modifiers.includes('public'),
                metadata: modifiers.length > 0 ? { modifiers } : undefined,
              })
              contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  /** Find the first child node of a given type and return its text */
  private findChildByText(node: SyntaxNode, type: string): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === type) {
        return child.text
      }
    }
    return null
  }

  private extractJavaModifiers(node: SyntaxNode): string[] {
    const modifiers: string[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'public' || child.type === 'private' || child.type === 'protected' ||
          child.type === 'static' || child.type === 'abstract' || child.type === 'final' ||
          child.type === 'synchronized' || child.type === 'volatile' || child.type === 'transient' ||
          child.type === 'native' || child.type === 'strictfp') {
        modifiers.push(child.type)
      }
      // Modifiers can also be grouped in a 'modifiers' node
      if (child.type === 'modifiers') {
        for (let j = 0; j < child.childCount; j++) {
          modifiers.push(child.child(j)!.text)
        }
      }
    }
    return modifiers
  }

  private extractJavaImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // import package.Class; or import package.*;
      if (node.type === 'import_declaration') {
        let importPath = ''
        let isWildcard = false

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          // tree-sitter-java uses 'scoped_identifier' for the full import path
          if (child.type === 'scoped_identifier') {
            importPath = child.text
          } else if (child.type === 'identifier' && !importPath) {
            // Simple identifier (rare for imports but handle it)
            importPath = child.text
          } else if (child.type === 'asterisk') {
            isWildcard = true
          }
        }

        if (importPath) {
          imports.push({
            source: filePath,
            target: importPath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: {
              rawImportPath: importPath,
              importKind: isWildcard ? 'java-wildcard-import' : 'java-import',
            },
          })
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractJavaCalls(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    const seenCalls = new Set<string>()

    const walk = (node: SyntaxNode): void => {
      // Method invocations: object.method(args) or method(args)
      if (node.type === 'method_invocation') {
        const nameNode = node.childForFieldName('name')
        const objectNode = node.childForFieldName('object')

        const methodName = nameNode?.text ?? ''
        const objectName = objectNode?.text ?? ''
        const fullCall = objectName ? `${objectName}.${methodName}` : methodName

        if (methodName && !this.isJavaBuiltin(methodName)) {
          const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
          const source = enclosingSymbol ? enclosingSymbol.id : filePath
          const dedupeKey = `${source}→${fullCall}`
          if (!seenCalls.has(dedupeKey)) {
            seenCalls.add(dedupeKey)
            calls.push({
              source,
              target: fullCall,
              type: AuraEdgeType.CALLS,
              confidence: objectName ? 0.5 : 0.7,
              metadata: { callName: fullCall, callTargetKind: objectName ? 'member' : 'direct', methodName },
            })
          }
        }
      }

      // Object creation: new ClassName(args)
      if (node.type === 'object_creation_expression') {
        const typeNode = node.childForFieldName('type')
        let className = typeNode?.text ?? ''
        // Fallback: look for type_identifier or scoped_identifier child
        if (!className) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!
            if (child.type === 'type_identifier' || child.type === 'scoped_identifier' ||
                child.type === 'class_identifier' || child.type === 'identifier') {
              if (child.text !== 'new') {
                className = child.text
                break
              }
            }
          }
        }

        if (className && !this.isJavaBuiltin(className)) {
          const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
          const source = enclosingSymbol ? enclosingSymbol.id : filePath
          const dedupeKey = `${source}→new:${className}`
          if (!seenCalls.has(dedupeKey)) {
            seenCalls.add(dedupeKey)
            calls.push({
              source,
              target: className,
              type: AuraEdgeType.CALLS,
              confidence: 0.8,
              metadata: { callName: `new ${className}`, callTargetKind: 'constructor' },
            })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private isJavaBuiltin(name: string): boolean {
    const builtins = new Set([
      'println', 'print', 'printf', 'format', 'toString', 'equals', 'hashCode',
      'getClass', 'notify', 'notifyAll', 'wait',
      'length', 'charAt', 'substring', 'indexOf', 'lastIndexOf', 'contains',
      'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'trim',
      'replace', 'replaceAll', 'split', 'matches', 'compareTo',
      'valueOf', 'parseInt', 'parseDouble', 'parseFloat', 'parseLong',
      'get', 'set', 'add', 'remove', 'size', 'clear',
      'isEmpty', 'iterator', 'hasNext', 'next', 'keySet', 'values', 'entrySet',
      'put', 'putAll', 'getKey', 'getValue',
      'append', 'insert', 'delete', 'reverse',
      'close', 'read', 'readLine', 'write', 'flush',
      'nextInt', 'nextLine', 'nextBoolean', 'nextDouble',
      'exit', 'currentTimeMillis', 'arraycopy', 'gc',
      'array', 'stream', 'collect', 'map', 'filter', 'reduce', 'forEach',
      'orElse', 'isPresent', 'get', 'of', 'empty',
      'abs', 'max', 'min', 'ceil', 'floor', 'round', 'random', 'sqrt', 'pow',
      'run', 'start', 'interrupt', 'join', 'sleep', 'yield',
      'getMessage', 'printStackTrace', 'fillInStackTrace',
      'clone', 'finalize',
    ])
    return builtins.has(name)
  }

  private extractJavaHeritage(
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Class extends/implements — tree-sitter-java uses specific field names
      if (node.type === 'class_declaration') {
        // Find class name — tree-sitter-java uses 'identifier' for names
        const className = this.findChildByText(node, 'identifier') ?? ''
        const source = className ? `${filePath}:${className}` : filePath

        // extends — in tree-sitter-java, this is in a 'superclass' node
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'superclass') {
            // The superclass node contains: extends <type_identifier>
            for (let j = 0; j < child.childCount; j++) {
              const superChild = child.child(j)!
              if (superChild.type === 'type_identifier' || superChild.type === 'scoped_identifier') {
                heritage.push({
                  source,
                  target: superChild.text,
                  type: AuraEdgeType.EXTENDS,
                  confidence: 0.9,
                  metadata: { rawTargetName: superChild.text, heritageKind: 'extends' },
                })
              }
            }
          }
          // implements — in tree-sitter-java, this is in a 'super_interfaces' node
          if (child.type === 'super_interfaces') {
            for (let j = 0; j < child.childCount; j++) {
              const ifaceChild = child.child(j)!
              // type_list contains type_identifiers
              if (ifaceChild.type === 'type_list') {
                for (let k = 0; k < ifaceChild.childCount; k++) {
                  const typeChild = ifaceChild.child(k)!
                  if (typeChild.type === 'type_identifier' || typeChild.type === 'scoped_identifier') {
                    heritage.push({
                      source,
                      target: typeChild.text,
                      type: AuraEdgeType.IMPLEMENTS,
                      confidence: 0.9,
                      metadata: { rawTargetName: typeChild.text, heritageKind: 'implements' },
                    })
                  }
                }
              }
              // Direct type_identifier in super_interfaces (single interface)
              if (ifaceChild.type === 'type_identifier' || ifaceChild.type === 'scoped_identifier') {
                heritage.push({
                  source,
                  target: ifaceChild.text,
                  type: AuraEdgeType.IMPLEMENTS,
                  confidence: 0.9,
                  metadata: { rawTargetName: ifaceChild.text, heritageKind: 'implements' },
                })
              }
            }
          }
        }
      }

      // Interface extends other interfaces
      if (node.type === 'interface_declaration') {
        const interfaceName = this.findChildByText(node, 'identifier') ?? ''
        const source = interfaceName ? `${filePath}:${interfaceName}` : filePath

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          // In tree-sitter-java, interface extends uses 'extends_interfaces'
          if (child.type === 'extends_interfaces') {
            for (let j = 0; j < child.childCount; j++) {
              const extendsChild = child.child(j)!
              if (extendsChild.type === 'type_list') {
                for (let k = 0; k < extendsChild.childCount; k++) {
                  const typeChild = extendsChild.child(k)!
                  if (typeChild.type === 'type_identifier' || typeChild.type === 'scoped_identifier') {
                    heritage.push({
                      source,
                      target: typeChild.text,
                      type: AuraEdgeType.EXTENDS,
                      confidence: 0.9,
                      metadata: { rawTargetName: typeChild.text, heritageKind: 'interface-extends' },
                    })
                  }
                }
              }
              if (extendsChild.type === 'type_identifier' || extendsChild.type === 'scoped_identifier') {
                heritage.push({
                  source,
                  target: extendsChild.text,
                  type: AuraEdgeType.EXTENDS,
                  confidence: 0.9,
                  metadata: { rawTargetName: extendsChild.text, heritageKind: 'interface-extends' },
                })
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  // ── C parsing ──────────────────────────────────────────────────────────────

  private parseCFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractCDeclarations(tree, filePath, symbols, contains, seenIds)
      this.extractCImports(tree, filePath, imports)
      this.extractCCalls(tree, filePath, calls, symbols)
      // C has no inheritance — heritage is empty

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractCDeclarations(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Function definitions: int main() { ... }
      if (node.type === 'function_definition') {
        const name = this.extractCFunctionName(node)
        if (name) {
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isStatic = this.hasCStorageClass(node, 'static')
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Function,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: !isStatic,
              metadata: isStatic ? { modifiers: ['static'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Struct definitions: struct Point { int x; int y; };
      if (node.type === 'struct_specifier') {
        const nameNode = node.childForFieldName('name')
        // Only create a symbol if the struct has a name and a body
        if (nameNode && node.childForFieldName('body')) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Struct,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Enum definitions: enum Color { RED, GREEN, BLUE };
      if (node.type === 'enum_specifier') {
        const nameNode = node.childForFieldName('name')
        if (nameNode && node.childForFieldName('body')) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Enum,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Typedef: typedef struct { ... } Point; typedef int (*Comparator)(...);
      if (node.type === 'type_definition') {
        // The name can be:
        // 1. A direct type_identifier child (e.g., "typedef struct { int x; } Point;" → type_identifier "Point")
        // 2. Inside a declarator (e.g., "typedef int (*Comparator)(...);" → function_declarator → type_identifier)
        let name: string | null = null

        // Try type_identifier child directly on the type_definition
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'type_identifier') {
            name = child.text
            break
          }
        }

        // If no direct type_identifier, try the declarator
        if (!name) {
          const declaratorNode = node.childForFieldName('declarator')
          if (declaratorNode) {
            name = this.extractCDeclaratorName(declaratorNode)
          }
        }

        if (name) {
          // Check if this typedef wraps a struct/enum — if so, register it as Struct/Enum too
          let innerKind: AuraNodeKind | null = null
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!
            if (child.type === 'struct_specifier') {
              innerKind = AuraNodeKind.Struct
              break
            }
            if (child.type === 'enum_specifier') {
              innerKind = AuraNodeKind.Enum
              break
            }
          }

          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            // If this is a typedef of a struct/enum, register it as that kind instead of TypeAlias
            const kind = innerKind ?? AuraNodeKind.TypeAlias
            symbols.push({
              id: symbolId,
              kind,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Preprocessor macros: #define NAME value
      if (node.type === 'preproc_def') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          // Skip trivial/common macro names
          if (!this.isCBuiltinMacro(name)) {
            const symbolId = `${filePath}:${name}`
            if (!seenIds.has(symbolId)) {
              seenIds.add(symbolId)
              symbols.push({
                id: symbolId,
                kind: AuraNodeKind.Macro,
                name,
                filePath,
                range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                exported: true,
              })
              contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
            }
          }
        }
      }

      // Top-level declarations (function prototypes or global variables)
      // These can be at translation_unit level OR inside preproc_ifdef/preproc_if blocks
      if (node.type === 'declaration') {
        const parentType = node.parent?.type
        const isTopLevel = parentType === 'translation_unit' ||
          parentType === 'preproc_ifdef' || parentType === 'preproc_ifndef' ||
          parentType === 'preproc_if' || parentType === 'preproc_else' ||
          parentType === 'preproc_elif'
        if (isTopLevel) {
          // Check if this is a function declaration (prototype)
          const funcDeclarator = this.findFunctionDeclaratorInDeclaration(node)
          if (funcDeclarator) {
            const name = this.extractCDeclaratorName(funcDeclarator)
            if (name && !this.isCBuiltinFunction(name)) {
              const symbolId = `${filePath}:${name}`
              if (!seenIds.has(symbolId)) {
                seenIds.add(symbolId)
                const isStatic = this.hasCStorageClass(node, 'static')
                symbols.push({
                  id: symbolId,
                  kind: AuraNodeKind.Function,
                  name,
                  filePath,
                  range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                  exported: !isStatic,
                  metadata: isStatic ? { modifiers: ['static'] } : undefined,
                })
                contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
              }
            }
          } else {
            // Not a function — try as a global variable
            this.extractCGlobalVariables(node, filePath, symbols, contains, seenIds)
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCFunctionName(node: SyntaxNode): string | null {
    // function_definition has: type + declarator (which may be function_declarator)
    const declaratorNode = node.childForFieldName('declarator')
    if (declaratorNode) {
      return this.extractCDeclaratorName(declaratorNode)
    }
    // Fallback: look for function_declarator child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'function_declarator' || child.type === 'pointer_declarator') {
        return this.extractCDeclaratorName(child)
      }
    }
    return null
  }

  /** Recursively extract the identifier name from a C declarator chain.
   *  C declarators can be nested: pointer_declarator → function_declarator → identifier
   */
  private extractCDeclaratorName(node: SyntaxNode): string | null {
    if (node.type === 'identifier' || node.type === 'field_identifier' || node.type === 'type_identifier') {
      return node.text
    }
    // Walk children looking for the name
    const nameField = node.childForFieldName('declarator')
    if (nameField) {
      return this.extractCDeclaratorName(nameField)
    }
    // For function_declarator, the declarator field holds the name
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'identifier' || child.type === 'field_identifier' || child.type === 'type_identifier') {
        return child.text
      }
      if (child.type === 'function_declarator' || child.type === 'pointer_declarator' ||
          child.type === 'parenthesized_declarator') {
        const name = this.extractCDeclaratorName(child)
        if (name) return name
      }
    }
    return null
  }

  private hasCStorageClass(node: SyntaxNode, storageClass: string): boolean {
    // Check siblings for storage_class_specifier
    let current: SyntaxNode | null = node
    for (let i = 0; i < current.childCount; i++) {
      const child = current.child(i)!
      if (child.type === 'storage_class_specifier' && child.text === storageClass) {
        return true
      }
    }
    // Also check the declaration parent for C
    if (node.parent?.type === 'declaration') {
      for (let i = 0; i < node.parent.childCount; i++) {
        const child = node.parent.child(i)!
        if (child.type === 'storage_class_specifier' && child.text === storageClass) {
          return true
        }
      }
    }
    return false
  }

  private extractCGlobalVariables(
    node: SyntaxNode,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    // Top-level declarations like: int count; static const char *name;
    const declaratorNode = node.childForFieldName('declarator')
    if (declaratorNode) {
      const name = this.extractCDeclaratorName(declaratorNode)
      if (name) {
        const isStatic = this.hasCStorageClass(node, 'static')
        const symbolId = `${filePath}:${name}`
        if (!seenIds.has(symbolId)) {
          seenIds.add(symbolId)
          symbols.push({
            id: symbolId,
            kind: AuraNodeKind.Variable,
            name,
            filePath,
            range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
            exported: !isStatic,
            metadata: isStatic ? { modifiers: ['static'] } : undefined,
          })
          contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
        }
      }
    }
  }

  /** Find a function_declarator inside a declaration node (for function prototypes) */
  private findFunctionDeclaratorInDeclaration(node: SyntaxNode): SyntaxNode | null {
    const walk = (n: SyntaxNode): SyntaxNode | null => {
      if (n.type === 'function_declarator') return n
      for (let i = 0; i < n.childCount; i++) {
        const found = walk(n.child(i)!)
        if (found) return found
      }
      return null
    }
    // Only search the declarator field, not the whole declaration
    const declarator = node.childForFieldName('declarator')
    if (declarator) {
      return walk(declarator)
    }
    return null
  }

  private extractCImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // #include "path.h" or #include <path.h>
      if (node.type === 'preproc_include') {
        const pathNode = node.childForFieldName('path')
        if (pathNode) {
          if (pathNode.type === 'string_literal') {
            // Local include: #include "path.h"
            let importPath = ''
            for (let i = 0; i < pathNode.childCount; i++) {
              const child = pathNode.child(i)!
              if (child.type === 'string_content') {
                importPath = child.text
              }
            }
            // Fallback: strip quotes
            if (!importPath) {
              importPath = pathNode.text.replace(/^"(.*)"$/, '$1')
            }
            if (importPath) {
              imports.push({
                source: filePath,
                target: importPath,
                type: AuraEdgeType.IMPORTS,
                confidence: 0.9,
                metadata: { rawImportPath: importPath, importKind: 'c-local-include' },
              })
            }
          } else if (pathNode.type === 'system_lib_string') {
            // System include: #include <stdio.h> — strip < >
            const importPath = pathNode.text.replace(/^<(.*)>$/, '$1')
            if (importPath) {
              imports.push({
                source: filePath,
                target: importPath,
                type: AuraEdgeType.IMPORTS,
                confidence: 0.3,
                metadata: { rawImportPath: importPath, importKind: 'c-system-include' },
              })
            }
          } else {
            // Macro include or other
            const importPath = pathNode.text
            if (importPath) {
              imports.push({
                source: filePath,
                target: importPath,
                type: AuraEdgeType.IMPORTS,
                confidence: 0.2,
                metadata: { rawImportPath: importPath, importKind: 'c-macro-include' },
              })
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCCalls(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    const seenCalls = new Set<string>()

    const walk = (node: SyntaxNode): void => {
      // Function calls: function_name(args)
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function')
        const funcName = funcNode?.text ?? ''

        // For simple function calls (identifier), extract the name
        if (funcNode?.type === 'identifier') {
          const callName = funcNode.text
          if (callName && !this.isCBuiltinFunction(callName)) {
            const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
            const source = enclosingSymbol ? enclosingSymbol.id : filePath
            const dedupeKey = `${source}→${callName}`
            if (!seenCalls.has(dedupeKey)) {
              seenCalls.add(dedupeKey)
              calls.push({
                source,
                target: callName,
                type: AuraEdgeType.CALLS,
                confidence: 0.7,
                metadata: { callName, callTargetKind: 'direct' },
              })
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private isCBuiltinFunction(name: string): boolean {
    const builtins = new Set([
      // stdio
      'printf', 'fprintf', 'sprintf', 'snprintf', 'scanf', 'fscanf', 'sscanf',
      'puts', 'fputs', 'gets', 'fgets', 'putchar', 'getchar', 'getchar_unlocked',
      'fopen', 'fclose', 'fread', 'fwrite', 'fseek', 'ftell', 'rewind', 'fflush',
      'feof', 'ferror', 'clearerr', 'remove', 'rename', 'tmpfile', 'tmpnam',
      // stdlib
      'malloc', 'calloc', 'realloc', 'free', 'abort', 'exit', 'atexit', 'quick_exit',
      'atoi', 'atol', 'atof', 'strtol', 'strtoul', 'strtod', 'strtof', 'strtold',
      'rand', 'srand', 'abs', 'labs', 'div', 'ldiv', 'qsort', 'bsearch',
      'getenv', 'system', 'exec', 'atoi',
      // string
      'strlen', 'strcpy', 'strncpy', 'strcat', 'strncat', 'strcmp', 'strncmp',
      'strchr', 'strrchr', 'strstr', 'strtok', 'strdup', 'strerror',
      'memcpy', 'memmove', 'memset', 'memcmp', 'memchr',
      // math
      'abs', 'fabs', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
      'log', 'log10', 'exp', 'ceil', 'floor', 'round', 'fmod', 'modf',
      // assert
      'assert',
      // signal
      'signal', 'raise',
      // setjmp
      'setjmp', 'longjmp',
      // common
      'sizeof', 'offsetof', 'NULL',
    ])
    return builtins.has(name)
  }

  private isCBuiltinMacro(name: string): boolean {
    const builtins = new Set([
      'NULL', 'TRUE', 'FALSE', 'EOF', 'BUFSIZ', 'FILENAME_MAX', 'FOPEN_MAX',
      'RAND_MAX', 'EXIT_SUCCESS', 'EXIT_FAILURE', 'INT_MIN', 'INT_MAX',
      'LONG_MIN', 'LONG_MAX', 'UINT_MAX', 'ULONG_MAX', 'CHAR_MIN', 'CHAR_MAX',
      'FLT_MIN', 'FLT_MAX', 'DBL_MIN', 'DBL_MAX', 'SIZE_MAX',
      '__LINE__', '__FILE__', '__DATE__', '__TIME__', '__STDC__', '__func__',
      'stdin', 'stdout', 'stderr', 'SEEK_SET', 'SEEK_CUR', 'SEEK_END',
    ])
    return builtins.has(name)
  }

  // ── C++ parsing ────────────────────────────────────────────────────────────

  private parseCppFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractCppDeclarations(tree, filePath, symbols, contains, seenIds)
      this.extractCppImports(tree, filePath, imports)
      this.extractCppCalls(tree, filePath, calls, symbols)
      this.extractCppHeritage(tree, filePath, heritage)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractCppDeclarations(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Class definitions: class Widget { ... };
      if (node.type === 'class_specifier') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCppAccessModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Class,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Struct definitions: struct Point { int x; int y; };
      if (node.type === 'struct_specifier') {
        const nameNode = node.childForFieldName('name')
        if (nameNode && node.childForFieldName('body')) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Struct,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Enum definitions (C++ also has enum class)
      if (node.type === 'enum_specifier') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            // Check if it's an enum class
            const isEnumClass = this.hasCppKeyword(node, 'class') || this.hasCppKeyword(node, 'struct')
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Enum,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
              metadata: isEnumClass ? { modifiers: ['enum_class'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Namespace definitions: namespace MyApp { ... }
      if (node.type === 'namespace_definition') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Namespace,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Function definitions (including methods)
      if (node.type === 'function_definition') {
        const name = this.extractCppFunctionName(node)
        if (name) {
          // Determine if this is a method:
          // 1. Inside a class/struct body, or
          // 2. Qualified identifier like Widget::getName (defined outside the class)
          const declaratorNode = node.childForFieldName('declarator')
          const isQualifiedMethod = declaratorNode?.type === 'qualified_identifier' ||
            (declaratorNode?.type === 'function_declarator' && this.hasQualifiedIdentifier(declaratorNode))
          const isMethod = this.isCppInsideClass(node) || isQualifiedMethod
          const kind = isMethod ? AuraNodeKind.Method : AuraNodeKind.Function
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCppMethodModifiers(node)
            symbols.push({
              id: symbolId,
              kind,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: !modifiers.includes('private') && !modifiers.includes('protected'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Method declarations inside class body (field_declaration with function_declarator)
      // In C++, class method prototypes appear as: void getName() const;
      // which is a field_declaration containing a function_declarator
      if (node.type === 'field_declaration') {
        const funcDecl = this.findFunctionDeclaratorInDeclaration(node)
        if (funcDecl) {
          // This is a method declaration, not a field
          const name = this.extractCDeclaratorName(funcDecl)
          if (name && !this.isCppBuiltinFunction(name)) {
            const symbolId = `${filePath}:${name}`
            if (!seenIds.has(symbolId)) {
              seenIds.add(symbolId)
              // Determine access modifier from context
              const modifiers: string[] = []
              let sibling = node.previousNamedSibling
              while (sibling) {
                if (sibling.type === 'access_specifier') {
                  modifiers.push(sibling.text)
                  break
                }
                sibling = sibling.previousNamedSibling
              }
              symbols.push({
                id: symbolId,
                kind: AuraNodeKind.Method,
                name,
                filePath,
                range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                exported: !modifiers.includes('private') && !modifiers.includes('protected'),
                metadata: modifiers.length > 0 ? { modifiers } : undefined,
              })
              contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
            }
          }
        } else {
          // This is a field (data member) declaration
          const declaratorNode = node.childForFieldName('declarator')
          if (declaratorNode) {
            const name = this.extractCDeclaratorName(declaratorNode)
            if (name) {
              const symbolId = `${filePath}:${name}`
              if (!seenIds.has(symbolId)) {
                seenIds.add(symbolId)
                const modifiers: string[] = []
                let sibling = node.previousNamedSibling
                while (sibling) {
                  if (sibling.type === 'access_specifier') {
                    modifiers.push(sibling.text)
                    break
                  }
                  sibling = sibling.previousNamedSibling
                }
                symbols.push({
                  id: symbolId,
                  kind: AuraNodeKind.Variable,
                  name,
                  filePath,
                  range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                  exported: !modifiers.includes('private') && !modifiers.includes('protected'),
                  metadata: modifiers.length > 0 ? { modifiers } : undefined,
                })
                contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
              }
            }
          }
        }
      }

      // Function declarations (prototypes)
      if (node.type === 'declaration' && node.parent?.type === 'translation_unit') {
        // Check for function_declarator inside — this is a function declaration/prototype
        const declaratorNode = node.childForFieldName('declarator')
        if (declaratorNode) {
          const funcDeclarator = this.findCppFunctionDeclarator(declaratorNode)
          if (funcDeclarator && !node.children.some(c => c.type === 'compound_statement')) {
            // This is a declaration, not a definition — still useful to track
            const name = this.extractCDeclaratorName(funcDeclarator)
            if (name && !this.isCppBuiltinFunction(name)) {
              const symbolId = `${filePath}:${name}`
              if (!seenIds.has(symbolId)) {
                seenIds.add(symbolId)
                const modifiers = this.extractCppMethodModifiers(node)
                symbols.push({
                  id: symbolId,
                  kind: AuraNodeKind.Function,
                  name,
                  filePath,
                  range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                  exported: !modifiers.includes('private') && !modifiers.includes('protected'),
                  metadata: modifiers.length > 0 ? { modifiers } : undefined,
                })
                contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
              }
            }
          }
        }
        // Also check for global variable declarations
        if (!funcDeclarator) {
          this.extractCppGlobalVariables(node, filePath, symbols, contains, seenIds)
        }
      }

      // Typedef / type alias: typedef int MyInt; using MyInt = int;
      if (node.type === 'type_definition') {
        const declaratorNode = node.childForFieldName('declarator')
        if (declaratorNode) {
          const name = this.extractCDeclaratorName(declaratorNode)
          if (name) {
            const symbolId = `${filePath}:${name}`
            if (!seenIds.has(symbolId)) {
              seenIds.add(symbolId)
              symbols.push({
                id: symbolId,
                kind: AuraNodeKind.TypeAlias,
                name,
                filePath,
                range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                exported: true,
              })
              contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
            }
          }
        }
      }

      // using alias: using MyInt = int;
      if (node.type === 'alias_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.TypeAlias,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Preprocessor macros: #define NAME value
      if (node.type === 'preproc_def') {
        const nameNode = node.childForFieldName('name')
        if (nameNode && !this.isCBuiltinMacro(nameNode.text)) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Macro,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCppFunctionName(node: SyntaxNode): string | null {
    // C++ function_definition has: type + declarator (which may be function_declarator or qualified)
    const declaratorNode = node.childForFieldName('declarator')
    if (declaratorNode) {
      // Qualified identifiers like "MyClass::myMethod" — extract the method name part
      if (declaratorNode.type === 'qualified_identifier') {
        // Get the last identifier after ::
        const parts = declaratorNode.text.split('::')
        return parts[parts.length - 1] || null
      }
      return this.extractCDeclaratorName(declaratorNode)
    }
    // Fallback
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'function_declarator' || child.type === 'pointer_declarator') {
        return this.extractCDeclaratorName(child)
      }
    }
    return null
  }

  private isCppInsideClass(node: SyntaxNode): boolean {
    let current = node.parent
    while (current) {
      if (current.type === 'class_specifier' || current.type === 'struct_specifier') {
        return true
      }
      current = current.parent
    }
    return false
  }

  /** Check if a function_declarator contains a qualified_identifier (e.g., Widget::getName) */
  private hasQualifiedIdentifier(node: SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'qualified_identifier') return true
      if (this.hasQualifiedIdentifier(child)) return true
    }
    return false
  }

  private extractCppMethodModifiers(node: SyntaxNode): string[] {
    const modifiers: string[] = []
    // Walk up to the declaration to find access specifiers
    let current: SyntaxNode | null = node
    // Check access_specifier siblings in parent
    if (current.parent?.type === 'field_declaration_list' || current.parent?.type === 'declaration_list') {
      const body = current.parent
      for (let i = 0; i < body.childCount; i++) {
        const sibling = body.child(i)!
        if (sibling.type === 'access_specifier') {
          // This is an access specifier in the class body
        }
      }
    }
    // Check for static, virtual, inline, etc. in declaration specifiers
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'storage_class_specifier' || child.type === 'virtual' ||
          child.type === 'inline' || child.type === 'const' || child.type === 'volatile') {
        modifiers.push(child.text)
      }
    }
    // Check parent declaration for access specifiers
    if (node.parent) {
      // Look for access_specifier before this node in the class body
      const classBody = node.parent
      for (let i = 0; i < classBody.childCount; i++) {
        const child = classBody.child(i)!
        if (child.type === 'access_specifier') {
          modifiers.push(child.text) // "public", "private", "protected"
        }
      }
    }
    return modifiers
  }

  private extractCppAccessModifiers(node: SyntaxNode): string[] {
    const modifiers: string[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'final' || child.type === 'abstract') {
        modifiers.push(child.text)
      }
    }
    return modifiers
  }

  private hasCppKeyword(node: SyntaxNode, keyword: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.text === keyword) return true
    }
    return false
  }

  private findCppFunctionDeclarator(node: SyntaxNode): SyntaxNode | null {
    if (node.type === 'function_declarator') return node
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      const found = this.findCppFunctionDeclarator(child)
      if (found) return found
    }
    return null
  }

  private extractCppGlobalVariables(
    node: SyntaxNode,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const declaratorNode = node.childForFieldName('declarator')
    if (declaratorNode) {
      const name = this.extractCDeclaratorName(declaratorNode)
      if (name && !this.isCppBuiltinFunction(name)) {
        // Only track if it has a function_declarator (it's a declaration, not a variable)
        // Otherwise it's a variable
        const funcDecl = this.findCppFunctionDeclarator(declaratorNode)
        if (!funcDecl) {
          const isStatic = this.hasCStorageClass(node, 'static')
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Variable,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: !isStatic,
              metadata: isStatic ? { modifiers: ['static'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }
    }
  }

  private extractCppImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    // C++ uses the same #include as C, plus using declarations
    const walk = (node: SyntaxNode): void => {
      // #include — same as C
      if (node.type === 'preproc_include') {
        const pathNode = node.childForFieldName('path')
        if (pathNode) {
          if (pathNode.type === 'string_literal') {
            let importPath = ''
            for (let i = 0; i < pathNode.childCount; i++) {
              const child = pathNode.child(i)!
              if (child.type === 'string_content') {
                importPath = child.text
              }
            }
            if (!importPath) {
              importPath = pathNode.text.replace(/^"(.*)"$/, '$1')
            }
            if (importPath) {
              imports.push({
                source: filePath,
                target: importPath,
                type: AuraEdgeType.IMPORTS,
                confidence: 0.9,
                metadata: { rawImportPath: importPath, importKind: 'cpp-local-include' },
              })
            }
          } else if (pathNode.type === 'system_lib_string') {
            const importPath = pathNode.text.replace(/^<(.*)>$/, '$1')
            if (importPath) {
              imports.push({
                source: filePath,
                target: importPath,
                type: AuraEdgeType.IMPORTS,
                confidence: 0.3,
                metadata: { rawImportPath: importPath, importKind: 'cpp-system-include' },
              })
            }
          }
        }
      }

      // using namespace std; using std::vector; using std::cout;
      if (node.type === 'using_declaration') {
        // The using declaration text is like "using namespace std" or "using std::vector"
        const usingText = node.text
          .replace(/^using\s+/, '')
          .replace(/;$/, '')
          .trim()
        if (usingText) {
          imports.push({
            source: filePath,
            target: usingText,
            type: AuraEdgeType.IMPORTS,
            confidence: usingText.startsWith('namespace') ? 0.5 : 0.7,
            metadata: { rawImportPath: usingText, importKind: 'cpp-using' },
          })
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCppCalls(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    const seenCalls = new Set<string>()

    const walk = (node: SyntaxNode): void => {
      // Function calls: func(args), obj.method(args), Namespace::func(args)
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function')
        if (funcNode) {
          // Simple function call: identifier
          if (funcNode.type === 'identifier') {
            const callName = funcNode.text
            if (callName && !this.isCppBuiltinFunction(callName)) {
              const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
              const source = enclosingSymbol ? enclosingSymbol.id : filePath
              const dedupeKey = `${source}→${callName}`
              if (!seenCalls.has(dedupeKey)) {
                seenCalls.add(dedupeKey)
                calls.push({
                  source,
                  target: callName,
                  type: AuraEdgeType.CALLS,
                  confidence: 0.7,
                  metadata: { callName, callTargetKind: 'direct' },
                })
              }
            }
          }
          // Qualified call: std::cout, Namespace::func
          else if (funcNode.type === 'qualified_identifier' || funcNode.type === 'field_expression') {
            const callName = funcNode.text
            if (callName && !this.isCppBuiltinFunction(callName)) {
              const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
              const source = enclosingSymbol ? enclosingSymbol.id : filePath
              const dedupeKey = `${source}→${callName}`
              if (!seenCalls.has(dedupeKey)) {
                seenCalls.add(dedupeKey)
                calls.push({
                  source,
                  target: callName,
                  type: AuraEdgeType.CALLS,
                  confidence: 0.5,
                  metadata: { callName, callTargetKind: 'member' },
                })
              }
            }
          }
        }
      }

      // Object creation: new ClassName(args)
      if (node.type === 'new_expression') {
        const typeNode = node.childForFieldName('type')
        if (typeNode) {
          const className = typeNode.text
          if (className && !this.isCppBuiltinFunction(className)) {
            const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
            const source = enclosingSymbol ? enclosingSymbol.id : filePath
            const dedupeKey = `${source}→new:${className}`
            if (!seenCalls.has(dedupeKey)) {
              seenCalls.add(dedupeKey)
              calls.push({
                source,
                target: className,
                type: AuraEdgeType.CALLS,
                confidence: 0.8,
                metadata: { callName: `new ${className}`, callTargetKind: 'constructor' },
              })
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCppHeritage(
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // C++ class inheritance: class Derived : public Base { ... };
      if (node.type === 'class_specifier') {
        const nameNode = node.childForFieldName('name')
        const className = nameNode?.text ?? ''
        const source = className ? `${filePath}:${className}` : filePath

        // Look for base_class_clause
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'base_class_clause') {
            // base_class_clause contains access_specifiers and type_identifiers
            for (let j = 0; j < child.childCount; j++) {
              const baseChild = child.child(j)!
              if (baseChild.type === 'type_identifier' || baseChild.type === 'qualified_identifier' ||
                  baseChild.type === 'template_type') {
                heritage.push({
                  source,
                  target: baseChild.text,
                  type: AuraEdgeType.EXTENDS,
                  confidence: 0.9,
                  metadata: { rawTargetName: baseChild.text, heritageKind: 'class-extends' },
                })
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private isCppBuiltinFunction(name: string): boolean {
    // Combine C builtins with C++ additions
    if (this.isCBuiltinFunction(name)) return true
    const cppBuiltins = new Set([
      // iostream
      'cout', 'cin', 'cerr', 'clog', 'endl', 'flush', 'setw', 'setfill', 'setprecision',
      'ostream', 'istream', 'iostream', 'stringstream', 'istringstream', 'ostringstream',
      // STL algorithms
      'sort', 'stable_sort', 'partial_sort', 'nth_element',
      'find', 'find_if', 'find_if_not', 'find_end', 'find_first_of',
      'count', 'count_if', 'mismatch', 'equal',
      'search', 'search_n', 'copy', 'copy_n', 'copy_if', 'copy_backward',
      'move', 'move_backward', 'swap', 'swap_ranges', 'iter_swap',
      'transform', 'replace', 'replace_if', 'replace_copy', 'replace_copy_if',
      'fill', 'fill_n', 'generate', 'generate_n',
      'remove', 'remove_if', 'remove_copy', 'remove_copy_if',
      'unique', 'unique_copy', 'reverse', 'reverse_copy', 'rotate', 'rotate_copy',
      'partition', 'stable_partition', 'partition_point', 'partition_copy',
      'merge', 'inplace_merge',
      'accumulate', 'inner_product', 'adjacent_difference', 'partial_sum',
      'for_each', 'any_of', 'all_of', 'none_of',
      'min', 'max', 'minmax', 'min_element', 'max_element', 'minmax_element', 'clamp',
      'lexicographical_compare', 'next_permutation', 'prev_permutation',
      // STL containers
      'vector', 'list', 'deque', 'map', 'set', 'unordered_map', 'unordered_set',
      'stack', 'queue', 'priority_queue', 'array', 'pair', 'tuple',
      'make_pair', 'make_tuple', 'get', 'tie',
      // STL utilities
      'make_shared', 'make_unique', 'shared_ptr', 'unique_ptr', 'weak_ptr',
      'dynamic_pointer_cast', 'static_pointer_cast', 'const_pointer_cast',
      'make_optional', 'optional', 'nullopt',
      'variant', 'visit', 'holds_alternative', 'get_if',
      'make_exception_ptr', 'current_exception', 'rethrow_exception',
      // Memory
      'new', 'delete', 'malloc', 'calloc', 'realloc', 'free',
      'operator_new', 'operator_delete',
      // String
      'string', 'wstring', 'u16string', 'u32string', 'to_string', 'stoi', 'stol',
      'stoul', 'stoll', 'stoull', 'stof', 'stod', 'stold',
      // Thread
      'thread', 'mutex', 'lock_guard', 'unique_lock', 'condition_variable',
      'async', 'future', 'promise', 'packaged_task',
      // Other common
      'size', 'empty', 'data', 'begin', 'end', 'rbegin', 'rend',
      'front', 'back', 'push_back', 'push_front', 'pop_back', 'pop_front',
      'emplace_back', 'emplace_front', 'emplace', 'insert', 'erase',
      'clear', 'resize', 'reserve', 'capacity', 'shrink_to_fit',
      'at', 'substr', 'append', 'compare', 'c_str',
      'abs', 'fabs', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'log', 'exp',
    ])
    return cppBuiltins.has(name)
  }

  // ── C# parsing ──────────────────────────────────────────────────────────────

  private parseCSharpFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractCSharpDeclarations(tree, filePath, symbols, contains, seenIds)
      this.extractCSharpImports(tree, filePath, imports)
      this.extractCSharpCalls(tree, filePath, calls, symbols)
      this.extractCSharpHeritage(tree, filePath, heritage)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractCSharpDeclarations(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Class declarations
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Class,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Interface declarations
      if (node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Interface,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Struct declarations
      if (node.type === 'struct_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Struct,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Enum declarations
      if (node.type === 'enum_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Enum,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Delegate declarations
      if (node.type === 'delegate_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Delegate,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Namespace declarations
      if (node.type === 'namespace_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Namespace,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Method declarations
      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Method,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Constructor declarations (use .ctor suffix to avoid colliding with class name)
      if (node.type === 'constructor_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}.ctor`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Method,
              name: `${name}()`,  // Show as "User()" to distinguish from the class
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers: [...modifiers, 'constructor'] } : { modifiers: ['constructor'] },
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Property declarations
      if (node.type === 'property_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const modifiers = this.extractCSharpModifiers(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Variable,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: modifiers.includes('public'),
              metadata: modifiers.length > 0 ? { modifiers } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCSharpModifiers(node: SyntaxNode): string[] {
    const modifiers: string[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'modifier') {
        modifiers.push(child.text)
      }
      if (child.type === 'public' || child.type === 'private' || child.type === 'protected' ||
          child.type === 'internal' || child.type === 'static' || child.type === 'abstract' ||
          child.type === 'sealed' || child.type === 'virtual' || child.type === 'override' ||
          child.type === 'readonly' || child.type === 'async' || child.type === 'partial') {
        modifiers.push(child.text)
      }
    }
    return modifiers
  }

  private extractCSharpImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // using directives: using System; using MyApp.Services; using static Math; using X = Y;
      if (node.type === 'using_directive') {
        let importPath = ''
        let importKind = 'using'

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'identifier' || child.type === 'qualified_name') {
            importPath = child.text
          }
          if (child.type === 'static') {
            importKind = 'using-static'
          }
          // Check for alias: using X = Y; — the alias target is after '='
          if (child.type === 'name_equals') {
            // This is an alias — the target is what we want
            for (let j = 0; j < child.childCount; j++) {
              const eqChild = child.child(j)!
              if (eqChild.type === 'identifier' || eqChild.type === 'qualified_name') {
                importPath = eqChild.text
                importKind = 'using-alias'
              }
            }
          }
        }

        if (importPath) {
          imports.push({
            source: filePath,
            target: importPath,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: { rawImportPath: importPath, importKind },
          })
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCSharpCalls(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    const seenCalls = new Set<string>()

    const walk = (node: SyntaxNode): void => {
      // Method invocations: obj.Method(args)
      if (node.type === 'invocation_expression') {
        const funcNode = node.childForFieldName('function')
        if (funcNode) {
          const callName = funcNode.text
          if (callName && !this.isCSharpBuiltin(callName)) {
            const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
            const source = enclosingSymbol ? enclosingSymbol.id : filePath
            const dedupeKey = `${source}→${callName}`
            if (!seenCalls.has(dedupeKey)) {
              seenCalls.add(dedupeKey)
              calls.push({
                source,
                target: callName,
                type: AuraEdgeType.CALLS,
                confidence: funcNode.type === 'member_access_expression' ? 0.5 : 0.7,
                metadata: { callName, callTargetKind: funcNode.type === 'member_access_expression' ? 'member' : 'direct' },
              })
            }
          }
        }
      }

      // Object creation: new ClassName(args)
      if (node.type === 'object_creation_expression') {
        const typeNode = node.childForFieldName('type')
        const className = typeNode?.text ?? ''
        if (className && !this.isCSharpBuiltin(className)) {
          const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
          const source = enclosingSymbol ? enclosingSymbol.id : filePath
          const dedupeKey = `${source}→new:${className}`
          if (!seenCalls.has(dedupeKey)) {
            seenCalls.add(dedupeKey)
            calls.push({
              source,
              target: className,
              type: AuraEdgeType.CALLS,
              confidence: 0.8,
              metadata: { callName: `new ${className}`, callTargetKind: 'constructor' },
            })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractCSharpHeritage(
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Class inheritance: class Derived : Base, IInterface { }
      if (node.type === 'class_declaration' || node.type === 'struct_declaration') {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text ?? ''
        const source = name ? `${filePath}:${name}` : filePath

        // base_list contains the inheritance info
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'base_list') {
            for (let j = 0; j < child.childCount; j++) {
              const baseChild = child.child(j)!
              if (baseChild.type === 'identifier' || baseChild.type === 'qualified_name' ||
                  baseChild.type === 'type_identifier' || baseChild.type === 'predefined_type') {
                heritage.push({
                  source,
                  target: baseChild.text,
                  // C# doesn't distinguish extends vs implements in base_list — first is extends, rest are implements
                  type: j === 1 ? AuraEdgeType.EXTENDS : AuraEdgeType.IMPLEMENTS,
                  confidence: 0.9,
                  metadata: { rawTargetName: baseChild.text, heritageKind: j === 1 ? 'extends' : 'implements' },
                })
              }
            }
          }
        }
      }

      // Interface inheritance
      if (node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text ?? ''
        const source = name ? `${filePath}:${name}` : filePath

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'base_list') {
            for (let j = 0; j < child.childCount; j++) {
              const baseChild = child.child(j)!
              if (baseChild.type === 'identifier' || baseChild.type === 'qualified_name' ||
                  baseChild.type === 'type_identifier' || baseChild.type === 'predefined_type') {
                heritage.push({
                  source,
                  target: baseChild.text,
                  type: AuraEdgeType.EXTENDS,
                  confidence: 0.9,
                  metadata: { rawTargetName: baseChild.text, heritageKind: 'interface-extends' },
                })
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private isCSharpBuiltin(name: string): boolean {
    const builtins = new Set([
      // Types
      'Console', 'String', 'Object', 'Int32', 'Int64', 'Double', 'Single',
      'Boolean', 'Byte', 'Char', 'Decimal', 'Guid', 'DateTime', 'TimeSpan',
      'Math', 'Environment', 'Task', 'Thread', 'Monitor', 'GC',
      // LINQ
      'Select', 'Where', 'OrderBy', 'OrderByDescending', 'GroupBy', 'SelectMany',
      'FirstOrDefault', 'LastOrDefault', 'SingleOrDefault', 'First', 'Last', 'Single',
      'Any', 'All', 'Count', 'Sum', 'Min', 'Max', 'Average', 'ToList', 'ToArray',
      'ToDictionary', 'ToLookup', 'Distinct', 'Union', 'Intersect', 'Except',
      'Skip', 'Take', 'SkipWhile', 'TakeWhile', 'Reverse', 'Concat', 'Zip',
      // String methods
      'ToString', 'Equals', 'GetHashCode', 'GetType', 'CompareTo',
      'Length', 'Substring', 'IndexOf', 'LastIndexOf', 'Contains', 'StartsWith', 'EndsWith',
      'Replace', 'Split', 'Trim', 'ToUpper', 'ToLower', 'PadLeft', 'PadRight',
      'Format', 'Join', 'IsNullOrEmpty', 'IsNullOrWhiteSpace',
      // Collections
      'Add', 'Remove', 'Clear', 'ContainsKey', 'TryGetValue', 'Count',
      'GetEnumerator', 'MoveNext', 'Current', 'Key', 'Value',
      // Common
      'Dispose', 'Finalize', 'MemberwiseClone', 'ReferenceEquals',
      'nameof', 'typeof', 'sizeof', 'checked', 'unchecked',
      'get', 'set', 'value',
    ])
    return builtins.has(name)
  }

  // ── Go parsing ──────────────────────────────────────────────────────────────

  private parseGoFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractGoDeclarations(tree, filePath, symbols, contains, seenIds)
      this.extractGoImports(tree, filePath, imports)
      this.extractGoCalls(tree, filePath, calls, symbols)
      this.extractGoHeritage(tree, filePath, heritage)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractGoDeclarations(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Package clause — tree-sitter-go uses package_identifier child, not a named field
      if (node.type === 'package_clause') {
        let nameNode: SyntaxNode | null = node.childForFieldName('name')
        if (!nameNode) {
          // Fallback: find package_identifier child directly
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!
            if (child.type === 'package_identifier') {
              nameNode = child
              break
            }
          }
        }
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:pkg:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Namespace,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Function declarations
      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isExported = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Function,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isExported,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Method declarations (with receiver)
      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const receiverType = this.extractGoReceiverType(node)
          const symbolId = receiverType ? `${filePath}:${receiverType}.${name}` : `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isExported = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Method,
              name: receiverType ? `${receiverType}.${name}` : name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isExported,
              metadata: receiverType ? { receiver: receiverType } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Type declarations
      if (node.type === 'type_declaration') {
        // type_declaration contains type_spec or type_alias
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'type_spec') {
            const nameNode = child.childForFieldName('name')
            const typeNode = child.childForFieldName('type')
            if (nameNode) {
              const name = nameNode.text
              const symbolId = `${filePath}:${name}`
              if (!seenIds.has(symbolId)) {
                seenIds.add(symbolId)
                const isExported = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
                let kind = AuraNodeKind.TypeAlias
                if (typeNode) {
                  if (typeNode.type === 'struct_type') kind = AuraNodeKind.Struct
                  else if (typeNode.type === 'interface_type') kind = AuraNodeKind.Interface
                }
                symbols.push({
                  id: symbolId,
                  kind,
                  name,
                  filePath,
                  range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                  exported: isExported,
                })
                contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
              }
            }
          } else if (child.type === 'type_alias') {
            const nameNode = child.childForFieldName('name')
            if (nameNode) {
              const name = nameNode.text
              const symbolId = `${filePath}:${name}`
              if (!seenIds.has(symbolId)) {
                seenIds.add(symbolId)
                const isExported = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
                symbols.push({
                  id: symbolId,
                  kind: AuraNodeKind.TypeAlias,
                  name,
                  filePath,
                  range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                  exported: isExported,
                })
                contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
              }
            }
          }
        }
      }

      // Var declarations
      if (node.type === 'var_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'var_spec') {
            const nameNode = child.childForFieldName('name')
            if (nameNode) {
              const name = nameNode.text
              const symbolId = `${filePath}:${name}`
              if (!seenIds.has(symbolId)) {
                seenIds.add(symbolId)
                const isExported = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
                symbols.push({
                  id: symbolId,
                  kind: AuraNodeKind.Variable,
                  name,
                  filePath,
                  range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                  exported: isExported,
                })
                contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
              }
            }
          }
        }
      }

      // Const declarations
      if (node.type === 'const_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'const_spec') {
            const nameNode = child.childForFieldName('name')
            if (nameNode) {
              const name = nameNode.text
              const symbolId = `${filePath}:${name}`
              if (!seenIds.has(symbolId)) {
                seenIds.add(symbolId)
                const isExported = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
                symbols.push({
                  id: symbolId,
                  kind: AuraNodeKind.Variable,
                  name,
                  filePath,
                  range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
                  exported: isExported,
                  metadata: { kind: 'const' },
                })
                contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractGoReceiverType(node: SyntaxNode): string | null {
    // method_declaration has a receiver field: (parameter_list (parameter_declaration name: (identifier) type: (pointer_type (type_identifier))))
    const receiver = node.childForFieldName('receiver')
    if (!receiver) return null
    // Walk the receiver parameter_list to find the type
    for (let i = 0; i < receiver.childCount; i++) {
      const child = receiver.child(i)!
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type')
        if (typeNode) {
          if (typeNode.type === 'pointer_type' || typeNode.type === 'qualified_type') {
            // Dig into pointer_type to find type_identifier
            for (let j = 0; j < typeNode.childCount; j++) {
              const inner = typeNode.child(j)!
              if (inner.type === 'type_identifier') return inner.text
            }
            // If no type_identifier found, return the text without the *
            const text = typeNode.text
            return text.replace(/^\*/, '')
          }
          if (typeNode.type === 'type_identifier') return typeNode.text
          return typeNode.text
        }
      }
    }
    return null
  }

  private extractGoImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'import_declaration') {
        // Can have import_spec_list (grouped) or a single import_spec
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'import_spec_list') {
            for (let j = 0; j < child.childCount; j++) {
              const spec = child.child(j)!
              if (spec.type === 'import_spec') {
                this.extractGoImportSpec(spec, filePath, imports)
              }
            }
          } else if (child.type === 'import_spec') {
            this.extractGoImportSpec(child, filePath, imports)
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractGoImportSpec(spec: SyntaxNode, filePath: string, imports: AuraEdge[]): void {
    const pathNode = spec.childForFieldName('path')
    if (pathNode) {
      // path is interpreted_string_literal or raw_string_literal — strip quotes
      let importPath = pathNode.text
      if (importPath.startsWith('"') && importPath.endsWith('"')) {
        importPath = importPath.slice(1, -1)
      } else if (importPath.startsWith('`') && importPath.endsWith('`')) {
        importPath = importPath.slice(1, -1)
      }
      // Also check for interpreted_string_literal_content
      if (!importPath && pathNode.childCount > 0) {
        const content = pathNode.child(0)!
        if (content.type === 'interpreted_string_literal_content') {
          importPath = content.text
        }
      }

      if (importPath) {
        // Determine confidence based on path type
        let confidence = 0.9
        let importKind = 'go-import'
        if (!importPath.includes('/') && !importPath.includes('.')) {
          // Standard library like "fmt", "os" — no local resolution
          confidence = 0.3
          importKind = 'go-stdlib'
        } else if (importPath.includes('.')) {
          // External package like "github.com/..." — likely external
          confidence = 0.3
          importKind = 'go-external'
        } else if (importPath.startsWith('./') || importPath.startsWith('../')) {
          // Relative import
          confidence = 0.8
          importKind = 'go-relative'
        }

        // Check for import alias: import alias "path"
        const nameNode = spec.childForFieldName('name')
        const alias = nameNode ? nameNode.text : undefined

        imports.push({
          source: filePath,
          target: importPath,
          type: AuraEdgeType.IMPORTS,
          confidence,
          metadata: { rawImportPath: importPath, importKind, ...(alias ? { alias } : {}) },
        })
      }
    }
  }

  private extractGoCalls(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    const seenCalls = new Set<string>()

    const walk = (node: SyntaxNode): void => {
      // Function/method calls
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function')
        if (funcNode) {
          if (funcNode.type === 'selector_expression') {
            // Method call: obj.Method()
            const fieldNode = funcNode.childForFieldName('field')
            const operandNode = funcNode.childForFieldName('operand')
            const methodName = fieldNode?.text ?? ''
            const objectName = operandNode?.text ?? ''
            const callName = funcNode.text
            if (methodName && !this.isGoBuiltin(methodName)) {
              const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
              const source = enclosingSymbol ? enclosingSymbol.id : filePath
              const dedupeKey = `${source}→${callName}`
              if (!seenCalls.has(dedupeKey)) {
                seenCalls.add(dedupeKey)
                calls.push({
                  source,
                  target: callName,
                  type: AuraEdgeType.CALLS,
                  confidence: 0.5,
                  metadata: { callName, callTargetKind: 'member', objectName, methodName },
                })
              }
            }
          } else if (funcNode.type === 'identifier') {
            // Direct function call: funcName()
            const callName = funcNode.text
            if (callName && !this.isGoBuiltin(callName)) {
              const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
              const source = enclosingSymbol ? enclosingSymbol.id : filePath
              const dedupeKey = `${source}→${callName}`
              if (!seenCalls.has(dedupeKey)) {
                seenCalls.add(dedupeKey)
                calls.push({
                  source,
                  target: callName,
                  type: AuraEdgeType.CALLS,
                  confidence: 0.7,
                  metadata: { callName, callTargetKind: 'direct' },
                })
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractGoHeritage(
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Struct embedding — walk struct_type for embedded fields
      if (node.type === 'struct_type') {
        // Find the containing type_declaration to get the struct name
        let structName = ''
        let parent = node.parent
        while (parent) {
          if (parent.type === 'type_spec') {
            const nameNode = parent.childForFieldName('name')
            if (nameNode) structName = nameNode.text
            break
          }
          parent = parent.parent
        }

        const source = structName ? `${filePath}:${structName}` : filePath

        // Walk field_declaration_list for embedded fields
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'field_declaration_list') {
            for (let j = 0; j < child.childCount; j++) {
              const field = child.child(j)!
              if (field.type === 'field_declaration') {
                // Embedded field: no field_identifier, just a type_identifier or pointer_type
                const fieldNameNode = field.childForFieldName('name')
                if (!fieldNameNode) {
                  // This is an embedded field
                  for (let k = 0; k < field.childCount; k++) {
                    const fChild = field.child(k)!
                    if (fChild.type === 'type_identifier') {
                      heritage.push({
                        source,
                        target: fChild.text,
                        type: AuraEdgeType.EXTENDS,
                        confidence: 0.8,
                        metadata: { rawTargetName: fChild.text, heritageKind: 'struct-embed' },
                      })
                    } else if (fChild.type === 'pointer_type') {
                      // *BaseStruct embedding
                      for (let l = 0; l < fChild.childCount; l++) {
                        const ptrChild = fChild.child(l)!
                        if (ptrChild.type === 'type_identifier') {
                          heritage.push({
                            source,
                            target: ptrChild.text,
                            type: AuraEdgeType.EXTENDS,
                            confidence: 0.8,
                            metadata: { rawTargetName: ptrChild.text, heritageKind: 'struct-embed-pointer' },
                          })
                        }
                      }
                    } else if (fChild.type === 'qualified_type') {
                      heritage.push({
                        source,
                        target: fChild.text,
                        type: AuraEdgeType.EXTENDS,
                        confidence: 0.7,
                        metadata: { rawTargetName: fChild.text, heritageKind: 'struct-embed-qualified' },
                      })
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Interface embedding
      if (node.type === 'interface_type') {
        let ifaceName = ''
        let parent = node.parent
        while (parent) {
          if (parent.type === 'type_spec') {
            const nameNode = parent.childForFieldName('name')
            if (nameNode) ifaceName = nameNode.text
            break
          }
          parent = parent.parent
        }

        const source = ifaceName ? `${filePath}:${ifaceName}` : filePath

        // Walk for embedded interfaces (type_identifier or qualified_type children that are NOT method_elem)
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          for (let j = 0; j < child.childCount; j++) {
            const inner = child.child(j)!
            if (inner.type === 'type_identifier' && child.type !== 'method_elem') {
              heritage.push({
                source,
                target: inner.text,
                type: AuraEdgeType.EXTENDS,
                confidence: 0.8,
                metadata: { rawTargetName: inner.text, heritageKind: 'interface-embed' },
              })
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private isGoBuiltin(name: string): boolean {
    const builtins = new Set([
      // Built-in functions
      'append', 'cap', 'close', 'copy', 'delete', 'len', 'make', 'new',
      'panic', 'print', 'println', 'recover', 'complex', 'real', 'imag',
      // Built-in types
      'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64',
      'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string',
      'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
      // Common stdlib functions used as selectors
      'Println', 'Printf', 'Sprintf', 'Fprintf', 'Sprintln', 'Fprintln',
      'Fatal', 'Fatalf', 'Panic', 'Panicf',
      'Handle', 'HandleFunc', 'ListenAndServe',
      'Read', 'Write', 'Close', 'Flush', 'Open', 'Create',
      'String', 'Error', 'Format', 'MarshalJSON', 'UnmarshalJSON',
    ])
    return builtins.has(name)
  }

  // ── Rust parsing ────────────────────────────────────────────────────────────

  private parseRustFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const calls: AuraEdge[] = []
      const heritage: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractRustDeclarations(tree, filePath, symbols, contains, seenIds)
      this.extractRustImports(tree, filePath, imports)
      this.extractRustCalls(tree, filePath, calls, symbols)
      this.extractRustHeritage(tree, filePath, heritage)

      return { filePath, symbols, imports, calls, heritage, contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractRustDeclarations(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    const walk = (node: SyntaxNode): void => {
      // Function items
      if (node.type === 'function_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Function,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: isPub ? { modifiers: ['pub'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Struct items
      if (node.type === 'struct_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Struct,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: isPub ? { modifiers: ['pub'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Enum items
      if (node.type === 'enum_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Enum,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: isPub ? { modifiers: ['pub'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Trait items
      if (node.type === 'trait_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Interface,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: isPub ? { modifiers: ['pub'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Type items (aliases)
      if (node.type === 'type_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.TypeAlias,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: isPub ? { modifiers: ['pub'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Module items
      if (node.type === 'mod_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Namespace,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: isPub ? { modifiers: ['pub'] } : undefined,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Macro definitions
      if (node.type === 'macro_definition') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Macro,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: true,
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Const items
      if (node.type === 'const_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Variable,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: { kind: 'const', ...(isPub ? { modifiers: ['pub'] } : {}) },
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Static items
      if (node.type === 'static_item') {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const symbolId = `${filePath}:${name}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            const isPub = this.hasRustPubModifier(node)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Variable,
              name,
              filePath,
              range: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
              exported: isPub,
              metadata: { modifiers: ['static', ...(isPub ? ['pub'] : [])] },
            })
            contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
          }
        }
      }

      // Impl items — extract methods as Method symbols
      if (node.type === 'impl_item') {
        const typeNode = node.childForFieldName('type')
        const selfType = typeNode?.text ?? ''
        const traitNode = node.childForFieldName('trait')
        const traitName = traitNode?.text ?? ''

        // Walk body for function_item children
        const bodyNode = node.childForFieldName('body')
        if (bodyNode) {
          for (let i = 0; i < bodyNode.childCount; i++) {
            const child = bodyNode.child(i)!
            if (child.type === 'function_item') {
              const nameNode = child.childForFieldName('name')
              if (nameNode) {
                const name = nameNode.text
                const fullName = selfType ? `${selfType}::${name}` : name
                const symbolId = `${filePath}:${fullName}`
                if (!seenIds.has(symbolId)) {
                  seenIds.add(symbolId)
                  const isPub = this.hasRustPubModifier(child)
                  symbols.push({
                    id: symbolId,
                    kind: AuraNodeKind.Method,
                    name: fullName,
                    filePath,
                    range: { startLine: child.startPosition.row + 1, endLine: child.endPosition.row + 1 },
                    exported: isPub || !!traitName, // Trait impl methods are effectively public
                    metadata: {
                      ...(selfType ? { selfType } : {}),
                      ...(traitName ? { trait: traitName } : {}),
                      ...(isPub ? { modifiers: ['pub'] } : {}),
                    },
                  })
                  contains.push({ source: filePath, target: symbolId, type: AuraEdgeType.CONTAINS, confidence: 1.0 })
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private hasRustPubModifier(node: SyntaxNode): boolean {
    // Check preceding siblings for 'pub' keyword
    const parent = node.parent
    if (!parent) {
      // Top-level — check the node's own children for 'pub'
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)!
        if (child.type === 'visibility_modifier') return true
        if (child.type === 'pub') return true
        // Stop at first named child (the item name)
        if (child.isNamed) break
      }
      return false
    }
    // Check the node's own children for visibility_modifier
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'visibility_modifier') return true
      if (child.type === 'pub') return true
      if (child.isNamed) break
    }
    return false
  }

  private extractRustImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'use_declaration') {
        const argNode = node.childForFieldName('argument')
        if (argNode) {
          this.extractRustUsePath(argNode, filePath, imports)
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractRustUsePath(node: SyntaxNode, filePath: string, imports: AuraEdge[]): void {
    if (node.type === 'scoped_identifier') {
      // e.g. std::collections::HashMap
      const path = node.text
      let confidence = 0.5
      let importKind = 'rust-use'
      if (path.startsWith('std::') || path.startsWith('core::') || path.startsWith('alloc::')) {
        confidence = 0.3
        importKind = 'rust-stdlib'
      } else if (path.startsWith('crate::') || path.startsWith('self::') || path.startsWith('super::')) {
        confidence = 0.7
        importKind = 'rust-local'
      }
      imports.push({
        source: filePath,
        target: path,
        type: AuraEdgeType.IMPORTS,
        confidence,
        metadata: { rawImportPath: path, importKind },
      })
    } else if (node.type === 'scoped_use_list') {
      // e.g. std::io::{Read, Write} — extract path + items
      const pathNode = node.childForFieldName('path')
      const listNode = node.childForFieldName('list')
      const basePath = pathNode?.text ?? ''
      if (listNode && listNode.type === 'use_list') {
        for (let i = 0; i < listNode.childCount; i++) {
          const child = listNode.child(i)!
          if (child.type === 'identifier') {
            const fullPath = basePath ? `${basePath}::${child.text}` : child.text
            let confidence = 0.5
            let importKind = 'rust-use'
            if (fullPath.startsWith('std::') || fullPath.startsWith('core::')) {
              confidence = 0.3
              importKind = 'rust-stdlib'
            } else if (fullPath.startsWith('crate::') || fullPath.startsWith('self::') || fullPath.startsWith('super::')) {
              confidence = 0.7
              importKind = 'rust-local'
            }
            imports.push({
              source: filePath,
              target: fullPath,
              type: AuraEdgeType.IMPORTS,
              confidence,
              metadata: { rawImportPath: fullPath, importKind },
            })
          }
        }
      }
    } else if (node.type === 'use_list') {
      // Grouped items: {A, B, C}
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)!
        if (child.type === 'identifier') {
          imports.push({
            source: filePath,
            target: child.text,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.5,
            metadata: { rawImportPath: child.text, importKind: 'rust-use' },
          })
        } else if (child.type === 'scoped_identifier') {
          this.extractRustUsePath(child, filePath, imports)
        }
      }
    } else if (node.type === 'use_wildcard') {
      // use std::io::prelude::*
      const pathNode = node.childForFieldName('path')
      const path = pathNode?.text ?? node.text
      imports.push({
        source: filePath,
        target: path,
        type: AuraEdgeType.IMPORTS,
        confidence: 0.3,
        metadata: { rawImportPath: path, importKind: 'rust-glob' },
      })
    } else if (node.type === 'use_as_clause') {
      // use std::io::Result as IoResult
      const pathNode = node.childForFieldName('path')
      const aliasNode = node.childForFieldName('alias')
      const path = pathNode?.text ?? ''
      const alias = aliasNode?.text ?? ''
      let confidence = 0.5
      let importKind = 'rust-use-alias'
      if (path.startsWith('std::') || path.startsWith('core::')) {
        confidence = 0.3
        importKind = 'rust-stdlib'
      } else if (path.startsWith('crate::') || path.startsWith('self::') || path.startsWith('super::')) {
        confidence = 0.7
        importKind = 'rust-local'
      }
      imports.push({
        source: filePath,
        target: path,
        type: AuraEdgeType.IMPORTS,
        confidence,
        metadata: { rawImportPath: path, importKind, ...(alias ? { alias } : {}) },
      })
    } else if (node.type === 'identifier') {
      // Simple identifier import
      imports.push({
        source: filePath,
        target: node.text,
        type: AuraEdgeType.IMPORTS,
        confidence: 0.5,
        metadata: { rawImportPath: node.text, importKind: 'rust-use' },
      })
    }
  }

  private extractRustCalls(
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    const seenCalls = new Set<string>()

    const walk = (node: SyntaxNode): void => {
      // Direct function calls
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function')
        if (funcNode) {
          if (funcNode.type === 'identifier') {
            const callName = funcNode.text
            if (callName && !this.isRustBuiltin(callName)) {
              const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
              const source = enclosingSymbol ? enclosingSymbol.id : filePath
              const dedupeKey = `${source}→${callName}`
              if (!seenCalls.has(dedupeKey)) {
                seenCalls.add(dedupeKey)
                calls.push({
                  source,
                  target: callName,
                  type: AuraEdgeType.CALLS,
                  confidence: 0.7,
                  metadata: { callName, callTargetKind: 'direct' },
                })
              }
            }
          } else if (funcNode.type === 'scoped_identifier') {
            // Qualified call: Server::new(), HashMap::new()
            const callName = funcNode.text
            if (callName && !this.isRustBuiltin(callName)) {
              const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
              const source = enclosingSymbol ? enclosingSymbol.id : filePath
              const dedupeKey = `${source}→${callName}`
              if (!seenCalls.has(dedupeKey)) {
                seenCalls.add(dedupeKey)
                calls.push({
                  source,
                  target: callName,
                  type: AuraEdgeType.CALLS,
                  confidence: 0.6,
                  metadata: { callName, callTargetKind: 'scoped' },
                })
              }
            }
          } else if (funcNode.type === 'field_expression') {
            // Method call chain: self.handle().unwrap() — the outer call is on the field_expression
            // The inner method call is handled via method_call_expression
            // We extract the method name from the field_expression
            const fieldNode = funcNode.childForFieldName('field')
            const methodName = fieldNode?.text ?? ''
            if (methodName && !this.isRustBuiltin(methodName)) {
              const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
              const source = enclosingSymbol ? enclosingSymbol.id : filePath
              const callName = funcNode.text
              const dedupeKey = `${source}→${callName}`
              if (!seenCalls.has(dedupeKey)) {
                seenCalls.add(dedupeKey)
                calls.push({
                  source,
                  target: callName,
                  type: AuraEdgeType.CALLS,
                  confidence: 0.5,
                  metadata: { callName, callTargetKind: 'member', methodName },
                })
              }
            }
          }
        }
      }

      // Method calls: object.method()
      if (node.type === 'method_call_expression') {
        const methodNode = node.childForFieldName('method')
        const objectNode = node.childForFieldName('object')
        const methodName = methodNode?.text ?? ''
        const objectName = objectNode?.text ?? ''
        if (methodName && !this.isRustBuiltin(methodName)) {
          const enclosingSymbol = this.findEnclosingSymbolFromTree(node, symbols, filePath)
          const source = enclosingSymbol ? enclosingSymbol.id : filePath
          const callName = objectName ? `${objectName}.${methodName}` : methodName
          const dedupeKey = `${source}→${callName}`
          if (!seenCalls.has(dedupeKey)) {
            seenCalls.add(dedupeKey)
            calls.push({
              source,
              target: callName,
              type: AuraEdgeType.CALLS,
              confidence: 0.5,
              metadata: { callName, callTargetKind: 'member', methodName, objectName },
            })
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private extractRustHeritage(
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    const walk = (node: SyntaxNode): void => {
      // impl Trait for Type → IMPLEMENTS edge
      if (node.type === 'impl_item') {
        const typeNode = node.childForFieldName('type')
        const traitNode = node.childForFieldName('trait')
        if (typeNode && traitNode) {
          const selfType = typeNode.text
          const traitName = traitNode.text
          heritage.push({
            source: `${filePath}:${selfType}`,
            target: traitName,
            type: AuraEdgeType.IMPLEMENTS,
            confidence: 0.9,
            metadata: { rawTargetName: traitName, heritageKind: 'impl-trait' },
          })
        }
      }

      // trait Sub: Super → EXTENDS edge
      if (node.type === 'trait_item') {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text ?? ''
        if (name) {
          // Check for trait_bounds
          const boundsNode = node.childForFieldName('bounds')
          if (boundsNode && boundsNode.type === 'trait_bounds') {
            for (let i = 0; i < boundsNode.childCount; i++) {
              const child = boundsNode.child(i)!
              if (child.type === 'type_identifier') {
                heritage.push({
                  source: `${filePath}:${name}`,
                  target: child.text,
                  type: AuraEdgeType.EXTENDS,
                  confidence: 0.9,
                  metadata: { rawTargetName: child.text, heritageKind: 'trait-supertrait' },
                })
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  private isRustBuiltin(name: string): boolean {
    const builtins = new Set([
      // Primitives
      'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
      'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
      'f32', 'f64', 'bool', 'char', 'str',
      // Common std/prelude
      'println', 'eprintln', 'print', 'eprint', 'format', 'panic',
      'assert', 'assert_eq', 'assert_ne', 'debug_assert', 'debug_assert_eq',
      'todo', 'unimplemented', 'unreachable', 'compile_error',
      'clone', 'copy', 'drop', 'default',
      // Common std methods
      'into', 'from', 'try_from', 'try_into', 'as_ref', 'as_mut',
      'to_string', 'to_owned',
      'len', 'is_empty', 'push', 'pop', 'insert', 'remove', 'contains',
      'iter', 'into_iter', 'next', 'map', 'filter', 'collect',
      'unwrap', 'expect', 'ok', 'err', 'is_ok', 'is_err', 'unwrap_or',
      'Some', 'None', 'Ok', 'Err', 'true', 'false',
      // Prelude macros
      'vec', 'dbg', 'write', 'writeln',
    ])
    return builtins.has(name)
  }

  private parseHtmlFile(filePath: string, source: string): ParseResult {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)
    if (!tree) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [], dataFlow: [] }
    }

    try {
      const symbols: AuraNode[] = []
      const imports: AuraEdge[] = []
      const contains: AuraEdge[] = []
      const seenIds = new Set<string>()

      this.extractHtmlImports(tree, filePath, imports)
      this.extractHtmlIds(tree, filePath, symbols, contains, seenIds)

      return { filePath, symbols, imports, calls: [], heritage: [], contains, dataFlow: [] }
    } finally {
      tree.delete()
    }
  }

  private extractHtmlImports(
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    // <script src="..."> and <link href="...">
    const walk = (node: SyntaxNode): void => {
      // <script src="..."> — in tree-sitter-html, attributes are inside start_tag
      if (node.type === 'script_element') {
        const srcAttr = this.findAttributeDeep(node, 'src')
        if (srcAttr) {
          imports.push({
            source: filePath,
            target: srcAttr,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: { rawImportPath: srcAttr, importKind: 'html-script' },
          })
        }
      }

      // <link href="..."> — can appear as self_closing_tag OR as element with start_tag
      // tree-sitter-html renders <link> as either depending on HTML structure
      const isLinkTag = (node.type === 'self_closing_tag' || node.type === 'element')
        && this.getTagName(node) === 'link'
      if (isLinkTag) {
        const href = this.findAttributeDeep(node, 'href')
        if (href) {
          imports.push({
            source: filePath,
            target: href,
            type: AuraEdgeType.IMPORTS,
            confidence: 0.8,
            metadata: { rawImportPath: href, importKind: 'html-link' },
          })
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  /** Get the tag name from an element, start_tag, or self_closing_tag node */
  private getTagName(node: SyntaxNode): string | null {
    // Check direct children first (for start_tag, self_closing_tag)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'tag_name') {
        return child.text
      }
      // For element nodes, the tag_name is inside the start_tag child
      if (child.type === 'start_tag') {
        const name = this.getTagName(child)
        if (name) return name
      }
    }
    return null
  }

  /** Search for an attribute recursively (attributes may be nested inside start_tag, etc.) */
  private findAttributeDeep(node: SyntaxNode, attrName: string): string | null {
    // First check direct children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type === 'attribute') {
        const value = this.extractAttributeValue(child, attrName)
        if (value !== null) return value
      }
    }
    // Then recurse into child nodes (e.g., start_tag inside script_element)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!
      if (child.type !== 'attribute') {
        const result = this.findAttributeDeep(child, attrName)
        if (result !== null) return result
      }
    }
    return null
  }

  /** Extract attribute value from an attribute node, or null if name doesn't match */
  private extractAttributeValue(attrNode: SyntaxNode, expectedName: string): string | null {
    let nameMatch = false
    for (let i = 0; i < attrNode.childCount; i++) {
      const child = attrNode.child(i)!
      if (child.type === 'attribute_name' && child.text === expectedName) {
        nameMatch = true
      }
      if (nameMatch && (child.type === 'attribute_value' || child.type === 'quoted_attribute_value')) {
        // attribute_value may be inside quoted_attribute_value
        if (child.type === 'quoted_attribute_value') {
          // Extract the inner attribute_value
          for (let j = 0; j < child.childCount; j++) {
            const inner = child.child(j)!
            if (inner.type === 'attribute_value') {
              return inner.text
            }
          }
          // Fallback: strip quotes from the quoted_attribute_value text
          return child.text.slice(1, -1)
        }
        return child.text
      }
    }
    return null
  }

  private extractHtmlIds(
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
  ): void {
    // Extract id="..." attributes as Selector symbols
    const walk = (node: SyntaxNode): void => {
      if (node.type === 'attribute') {
        const idValue = this.extractAttributeValue(node, 'id')
        if (idValue) {
          const symbolId = `${filePath}:#${idValue}`
          if (!seenIds.has(symbolId)) {
            seenIds.add(symbolId)
            symbols.push({
              id: symbolId,
              kind: AuraNodeKind.Selector,
              name: `#${idValue}`,
              filePath,
              range: {
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
              },
              exported: true,
            })
            contains.push({
              source: filePath,
              target: symbolId,
              type: AuraEdgeType.CONTAINS,
              confidence: 1.0,
            })
          }
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!)
      }
    }
    walk(tree.rootNode)
  }

  // ── Vue parsing ─────────────────────────────────────────────────────────────

  private async parseVueFile(filePath: string, source: string): Promise<ParseResult> {
    const symbols: AuraNode[] = []
    const imports: AuraEdge[] = []
    const calls: AuraEdge[] = []
    const heritage: AuraEdge[] = []
    const contains: AuraEdge[] = []

    // Create a Component symbol for the .vue file itself
    const componentName = path.basename(filePath, '.vue')
    const componentId = `${filePath}:${componentName}`
    symbols.push({
      id: componentId,
      kind: AuraNodeKind.Component,
      name: componentName,
      filePath,
      range: {
        startLine: 1,
        endLine: source.split('\n').length,
      },
      exported: true,
    })
    contains.push({
      source: filePath,
      target: componentId,
      type: AuraEdgeType.CONTAINS,
      confidence: 1.0,
    })

    // Extract SFC blocks using regex (tree-sitter-vue has no WASM build)
    const blocks = this.extractVueBlocksRegex(source)

    // Parse <script> block with JS/TS grammar
    if (blocks.script) {
      const scriptResult = await this.parseVueScriptBlock(filePath, blocks.script)
      symbols.push(...scriptResult.symbols)
      imports.push(...scriptResult.imports)
      calls.push(...scriptResult.calls)
      heritage.push(...scriptResult.heritage)
      contains.push(...scriptResult.contains)
      // Re-parent script symbols inside the component
      for (const sym of scriptResult.symbols) {
        contains.push({
          source: componentId,
          target: sym.id,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }
    }

    // Parse <style> block with CSS/SCSS grammar
    if (blocks.style) {
      const styleResult = await this.parseVueStyleBlock(filePath, blocks.style)
      symbols.push(...styleResult.symbols)
      imports.push(...styleResult.imports)
      contains.push(...styleResult.contains)
      for (const sym of styleResult.symbols) {
        contains.push({
          source: componentId,
          target: sym.id,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }
    }

    // Extract component references from <template> block
    if (blocks.template) {
      this.extractVueTemplateRefs(blocks.template.content, filePath, calls, symbols, contains)
    }

    // Data flow for Vue comes from the script block (already analyzed)
    const dataFlow: AuraEdge[] = []

    return { filePath, symbols, imports, calls, heritage, contains, dataFlow }
  }

  /**
   * Extract <template>, <script>, and <style> blocks from a Vue SFC using regex.
   * This approach avoids tree-sitter-vue, which has an external scanner incompatible with WASM.
   */
  private extractVueBlocksRegex(source: string): {
    script?: { content: string; lang: string; startLine: number }
    style?: { content: string; lang: string; startLine: number }
    template?: { content: string; startLine: number }
  } {
    const result: {
      script?: { content: string; lang: string; startLine: number }
      style?: { content: string; lang: string; startLine: number }
      template?: { content: string; startLine: number }
    } = {}

    // Match <script>, <script setup>, <style>, and <template> blocks
    // Handles optional lang attribute: <script lang="ts">, <style lang="scss">
    const blockRegex = /<(script|template|style)(\s+setup)?(\s[^>]*)?>([\s\S]*?)<\/\1>/gi

    let match: RegExpExecArray | null
    while ((match = blockRegex.exec(source)) !== null) {
      const tag = match[1].toLowerCase()
      const isSetup = match[2]?.trim().toLowerCase() === ' setup'
      const attrs = match[3] ?? ''
      const content = match[4]
      const startLine = source.slice(0, match.index).split('\n').length

      // Extract lang attribute
      const langMatch = attrs.match(/lang=["'](\w+)["']/i)
      const lang = langMatch ? langMatch[1].toLowerCase() : undefined

      if (tag === 'script') {
        const resolvedLang = lang ?? 'js'
        result.script = { content, lang: resolvedLang, startLine }
      } else if (tag === 'style') {
        const resolvedLang = lang ?? 'css'
        result.style = { content, lang: resolvedLang, startLine }
      } else if (tag === 'template') {
        result.template = { content, startLine }
      }
    }

    return result
  }

  private async parseVueScriptBlock(
    filePath: string,
    block: { content: string; lang: string; startLine: number },
  ): Promise<ParseResult> {
    // Determine the language for the script block
    let syntheticPath: string
    if (block.lang === 'ts' || block.lang === 'typescript') {
      syntheticPath = filePath + '.ts'
    } else {
      syntheticPath = filePath + '.js'
    }

    // Parse with the appropriate JS/TS parser
    const result = await this.parseFile(syntheticPath, block.content)

    // Adjust line numbers — the block starts at `startLine` in the original file
    const lineOffset = block.startLine - 1
    const adjustedSymbols = result.symbols.map(sym => ({
      ...sym,
      filePath,
      id: sym.id.replace(syntheticPath, filePath),
      range: sym.range ? {
        startLine: sym.range.startLine + lineOffset,
        endLine: sym.range.endLine + lineOffset,
      } : undefined,
    }))

    const adjustedImports = result.imports.map(edge => ({
      ...edge,
      source: edge.source.replace(syntheticPath, filePath),
    }))

    const adjustedCalls = result.calls.map(edge => ({
      ...edge,
      source: typeof edge.source === 'string' ? edge.source.replace(syntheticPath, filePath) : edge.source,
    }))

    const adjustedHeritage = result.heritage.map(edge => ({
      ...edge,
      source: edge.source.replace(syntheticPath, filePath),
    }))

    const adjustedContains = result.contains.map(edge => ({
      ...edge,
      source: edge.source.replace(syntheticPath, filePath),
      target: edge.target.replace(syntheticPath, filePath),
    }))

    return {
      filePath,
      symbols: adjustedSymbols,
      imports: adjustedImports,
      calls: adjustedCalls,
      heritage: adjustedHeritage,
      contains: adjustedContains,
      dataFlow: [],
    }
  }

  private async parseVueStyleBlock(
    filePath: string,
    block: { content: string; lang: string; startLine: number },
  ): Promise<ParseResult> {
    // Determine language for the style block
    const isScss = block.lang === 'scss' || block.lang === 'sass'
    const syntheticPath = filePath + (isScss ? '.scss' : '.css')

    // Parse with the appropriate parser
    const result = isScss
      ? this.parseScssFile(syntheticPath, block.content)
      : this.parseCssFile(syntheticPath, block.content)

    // Adjust line numbers and file paths
    const lineOffset = block.startLine - 1
    const adjustedSymbols = result.symbols.map(sym => ({
      ...sym,
      filePath,
      id: sym.id.replace(syntheticPath, filePath),
      range: sym.range ? {
        startLine: sym.range.startLine + lineOffset,
        endLine: sym.range.endLine + lineOffset,
      } : undefined,
    }))

    const adjustedImports = result.imports.map(edge => ({
      ...edge,
      source: edge.source.replace(syntheticPath, filePath),
    }))

    const adjustedContains = result.contains.map(edge => ({
      ...edge,
      source: edge.source.replace(syntheticPath, filePath),
      target: edge.target.replace(syntheticPath, filePath),
    }))

    return {
      filePath,
      symbols: adjustedSymbols,
      imports: adjustedImports,
      calls: [],
      heritage: [],
      contains: adjustedContains,
      dataFlow: [],
    }
  }

  private extractVueTemplateRefs(
    templateContent: string,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
    contains: AuraEdge[],
  ): void {
    // Extract PascalCase or kebab-case-multi-word component references from template
    // Match: <ComponentName, <component-name (multi-word), <MyComponent
    const componentRefRegex = /<([A-Z][a-zA-Z]*|[a-z]+-[a-z][\w-]*)/g
    let match: RegExpExecArray | null

    const seen = new Set<string>()
    while ((match = componentRefRegex.exec(templateContent)) !== null) {
      const componentName = match[1]
      const dedupeKey = `${filePath}→${componentName}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      calls.push({
        source: filePath,
        target: componentName,
        type: AuraEdgeType.CALLS,
        confidence: 0.7,
        metadata: { callName: componentName, callTargetKind: 'vue-component-ref', callSource: 'vue-template' },
      })
    }
  }

  // ── Original JS/TS extraction helpers ──────────────────────────────────────

  private extractWithQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    queryStr: string,
    kind: AuraNodeKind,
    symbols: AuraNode[],
    contains: AuraEdge[],
    seenIds: Set<string>,
    exportedNames: Set<string>,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, queryStr)
    } catch {
      // Query not supported by this grammar version
      return
    }

    try {
      const captures = query.captures(tree.rootNode)

      for (const { name, node } of captures) {
        if (name !== 'name') continue

        const symbolName = node.text
        const symbolId = `${filePath}:${symbolName}`

        // Deduplicate by id (skip if already seen — e.g. arrow function also matched by variable query)
        if (seenIds.has(symbolId)) continue
        seenIds.add(symbolId)

        const exported = this.isNodeExported(node, exportedNames, symbolName)

        const declNode = node.parent ?? node
        symbols.push({
          id: symbolId,
          kind,
          name: symbolName,
          filePath,
          range: {
            startLine: declNode.startPosition.row + 1,
            endLine: declNode.endPosition.row + 1,
          },
          exported,
        })

        contains.push({
          source: filePath,
          target: symbolId,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }
    } finally {
      query.delete()
    }
  }

  private isNodeExported(node: { parent: { type: string } | null }, exportedNames: Set<string>, symbolName: string): boolean {
    // Check if the symbol's declaration is directly inside an export statement
    let current: { parent: { type: string } | null } | null = node
    while (current) {
      if (current.parent) {
        const parentType = current.parent.type
        if (parentType === 'export_statement' || parentType === 'export_default_statement') {
          return true
        }
      }
      current = current.parent
    }
    // Check if the symbol name appears in an export default or export { } list
    if (exportedNames.has(symbolName)) {
      return true
    }
    return false
  }

  private collectExportNames(language: Language, tree: Tree, exportedNames: Set<string>): void {
    // Collect names from: export default <name>
    let query: Query | null = null
    try {
      query = new Query(language, '(export_statement (identifier) @name)')
    } catch {
      // Grammar may not support this query — skip silently
    }

    if (query) {
      try {
        const captures = query.captures(tree.rootNode)
        for (const { name, node } of captures) {
          if (name === 'name') {
            exportedNames.add(node.text)
          }
        }
      } finally {
        query.delete()
      }
    }

    // Collect names from: export { a, b, ... }
    try {
      query = new Query(language, '(export_clause (export_specifier name: (identifier) @name))')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name === 'name') {
          exportedNames.add(node.text)
        }
      }
    } finally {
      query.delete()
    }
  }

  private extractImports(
    language: Language,
    tree: Tree,
    filePath: string,
    imports: AuraEdge[],
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, '(import_statement) @import_stmt')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'import_stmt') continue

        const sourcePath = this.extractImportSource(node)
        if (!sourcePath) continue

        const importedSymbols = this.extractImportedNames(node)

        // Detect type-only import: `import type { X } from '...'` or `import { type X } from '...'`
        const isTypeOnly = this.isTypeOnlyImport(node)

        imports.push({
          source: filePath,
          target: sourcePath,
          type: AuraEdgeType.IMPORTS,
          confidence: 1.0,
          metadata: {
            rawImportPath: sourcePath,
            isTypeOnly,
            ...(importedSymbols.length > 0 && { importedSymbols }),
          },
        })
      }
    } finally {
      query.delete()
    }
  }

  private extractImportSource(importNode: { childCount: number; child: (i: number) => { type: string; childCount: number; child: (i: number) => { type: string; text: string } } }): string | null {
    for (let i = 0; i < importNode.childCount; i++) {
      const child = importNode.child(i)
      if (child.type === 'string') {
        for (let j = 0; j < child.childCount; j++) {
          const fragment = child.child(j)
          if (fragment.type === 'string_fragment') {
            return fragment.text
          }
        }
      }
    }
    return null
  }

  private extractImportedNames(importNode: { childCount: number; child: (i: number) => { type: string; text: string } }): Array<{ localName: string; exportedName: string }> {
    const names: Array<{ localName: string; exportedName: string }> = []
    this.collectImportNames(importNode as unknown as { type: string; childCount: number; child: (i: number) => unknown; text: string }, names)
    return names
  }

  private collectImportNames(node: { type: string; childCount: number; child: (i: number) => unknown; text: string }, names: Array<{ localName: string; exportedName: string }>): void {
    if (node.type === 'import_specifier') {
      // Named import: import { X } or import { X as Y }
      const nameNode = (node as { childForFieldName: (name: string) => { text: string } | null }).childForFieldName('name')
      const aliasNode = (node as { childForFieldName: (name: string) => { text: string } | null }).childForFieldName('alias')
      const exportedName = nameNode?.text ?? ''
      const localName = aliasNode?.text ?? exportedName
      if (exportedName) {
        names.push({ localName, exportedName })
      }
      return
    }

    // Default import: import X from '...'
    if (node.type === 'identifier' && (node as unknown as { parent: { type: string } }).parent?.type === 'import_clause') {
      names.push({ localName: node.text, exportedName: 'default' })
      return
    }

    // Recurse into children for named_imports, import_clause, etc.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && typeof child === 'object' && 'type' in child) {
        this.collectImportNames(child as { type: string; childCount: number; child: (i: number) => unknown; text: string }, names)
      }
    }
  }

  /** Detect type-only import: `import type { X } from '...'` or `import { type X } from '...'` */
  private isTypeOnlyImport(importNode: { childCount: number; child: (i: number) => { type: string; text: string } }): boolean {
    // `import type { X } from '...'` has a "type" keyword as a direct child of import_statement
    for (let i = 0; i < importNode.childCount; i++) {
      const child = importNode.child(i)
      // In tree-sitter-typescript, "type" appears as an identifier child
      // between "import" and the import_clause for type-only imports
      if (child.type === 'identifier' && child.text === 'type') {
        return true
      }
    }
    // `import { type X } from '...'` has inline type modifiers on import_specifiers
    // These are handled by checking if ALL import_specifiers have type modifiers
    // For simplicity, we check for any "type" identifier within named_imports
    return false
  }

  private extractCalls(
    language: Language,
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    // Direct call expressions: function_name(args)
    this.extractCallQuery(
      language, tree, filePath, calls, symbols,
      '(call_expression function: (identifier) @name)',
      false,
    )

    // Method call expressions: obj.method(args) — capture the full member_expression
    this.extractCallQuery(
      language, tree, filePath, calls, symbols,
      '(call_expression function: (member_expression) @method)',
      true,
    )
  }

  private extractJsxComponents(
    language: Language,
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
  ): void {
    // Self-closing JSX components: <Component />
    this.extractJsxQuery(
      language, tree, filePath, calls, symbols,
      '(jsx_self_closing_element name: (identifier) @name)',
      false,
    )

    // JSX elements with children: <Component>...</Component>
    this.extractJsxQuery(
      language, tree, filePath, calls, symbols,
      '(jsx_opening_element name: (identifier) @name)',
      false,
    )

    // Member expression JSX: <Canvas.Loader />
    this.extractJsxQuery(
      language, tree, filePath, calls, symbols,
      '(jsx_self_closing_element name: (member_expression) @name)',
      true,
    )

    // Member expression JSX with children: <Canvas.Loader>...</Canvas.Loader>
    this.extractJsxQuery(
      language, tree, filePath, calls, symbols,
      '(jsx_opening_element name: (member_expression) @name)',
      true,
    )
  }

  private extractJsxQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
    queryStr: string,
    isMemberExpression: boolean,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, queryStr)
    } catch {
      // Grammar doesn't support this query — skip
      return
    }

    const seenCalls = new Set<string>()

    try {
      const captures = query.captures(tree.rootNode)
      for (const { node } of captures) {
        const callName = node.text

        // Filter: lowercase identifiers are HTML intrinsic elements (div, span, etc.)
        if (!isMemberExpression && callName[0] === callName[0].toLowerCase()) continue

        // Find enclosing function/class to use as source
        const enclosingSymbol = this.findEnclosingSymbol(node, symbols)
        const source = enclosingSymbol ? enclosingSymbol.id : filePath

        // Deduplicate
        const dedupeKey = `${source}→${callName}`
        if (seenCalls.has(dedupeKey)) continue
        seenCalls.add(dedupeKey)

        calls.push({
          source,
          target: callName,
          type: AuraEdgeType.CALLS,
          confidence: isMemberExpression ? 0.5 : 0.7,
          metadata: {
            callName,
            callTargetKind: isMemberExpression ? 'member' : 'direct',
            callSource: 'jsx',
            ...(isMemberExpression && { methodName: callName.split('.').pop() }),
          },
        })
      }
    } finally {
      query.delete()
    }
  }

  // Skip React/useState-style setter names (setSomething) — but not real APIs like setTimeout/setInterval
  private static readonly SKIP_CALL_PATTERN = /^set[A-Z]/
  private static readonly SKIP_CALL_ALLOWLIST = new Set(['setTimeout', 'setInterval', 'setImmediate', 'setRequestHeader', 'setAttribute'])

  private extractCallQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    calls: AuraEdge[],
    symbols: AuraNode[],
    queryStr: string,
    isMemberExpression: boolean,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, queryStr)
    } catch {
      return
    }

    const seenCalls = new Set<string>()

    try {
      const captures = query.captures(tree.rootNode)
      for (const { node } of captures) {
        // For member expressions, node.text is the full "obj.method" — extract just the method name for filtering
        const callName = isMemberExpression
          ? node.text
          : node.text

        // Skip React state setters (setSomething pattern from useState destructuring)
        if (!isMemberExpression && AuraParser.SKIP_CALL_PATTERN.test(callName) && !AuraParser.SKIP_CALL_ALLOWLIST.has(callName)) continue

        // For member expressions, skip console.* calls (they're noise)
        if (isMemberExpression && callName.startsWith('console.')) continue

        // Find enclosing function/class to use as source
        const enclosingSymbol = this.findEnclosingSymbol(node, symbols)
        const source = enclosingSymbol ? enclosingSymbol.id : filePath

        // Deduplicate: skip if this (source, target) pair was already recorded
        const dedupeKey = `${source}→${callName}`
        if (seenCalls.has(dedupeKey)) continue
        seenCalls.add(dedupeKey)

        calls.push({
          source,
          target: callName,
          type: AuraEdgeType.CALLS,
          confidence: isMemberExpression ? 0.5 : 0.7,
          metadata: {
            callName,
            callTargetKind: isMemberExpression ? 'member' : 'direct',
            ...(isMemberExpression && { methodName: callName.split('.').pop() }),
          },
        })
      }
    } finally {
      query.delete()
    }
  }

  private isInsideDecorator(node: SyntaxNode): boolean {
    // Only filter calls that are directly inside the decorator node itself
    // (the @app.route(...) expression), NOT calls inside the decorated function body
    let current = node.parent
    while (current) {
      if (current.type === 'decorator') {
        return true
      }
      // Stop at decorated_definition — the function body is inside this, not the decorator
      if (current.type === 'decorated_definition') {
        return false
      }
      current = current.parent
    }
    return false
  }

  private findEnclosingSymbol(
    node: { parent: { type: string; parent: unknown } | null },
    symbols: AuraNode[],
  ): AuraNode | null {
    // Walk up the tree to find an enclosing function, method, or class
    let current = node.parent
    while (current) {
      const nodeType = (current as { type: string }).type

      if (nodeType === 'arrow_function') {
        // Arrow functions are named via their parent variable_declarator
        const parent = (current as { parent: { type: string; child: (i: number) => { text: string } } | null }).parent
        if (parent && parent.type === 'variable_declarator') {
          const nameNode = parent.child(0)
          if (nameNode) {
            const match = symbols.find(s => s.name === nameNode.text)
            if (match) return match
          }
        }
      } else if (
        nodeType === 'function_declaration' ||
        nodeType === 'method_definition' ||
        nodeType === 'class_declaration'
      ) {
        // Named declarations: the name is child(1)
        const nameNode = (current as { child: (i: number) => { text: string } }).child(1)
        if (nameNode) {
          const match = symbols.find(s => s.name === nameNode.text)
          if (match) return match
        }
      } else if (
        nodeType === 'function_definition' ||
        nodeType === 'class_definition'
      ) {
        // Python: name is via childForFieldName('name')
        const nameNode = (current as { childForFieldName: (name: string) => { text: string } | null }).childForFieldName('name')
        if (nameNode) {
          const match = symbols.find(s => s.name === nameNode.text)
          if (match) return match
        }
      }
      current = (current as { parent: { type: string; parent: unknown } | null }).parent
    }
    return null
  }

  private extractHeritage(
    language: Language,
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
  ): void {
    // Extract extends clauses
    this.extractHeritageQuery(
      language, tree, filePath, heritage,
      '(extends_clause value: (identifier) @parent)',
      AuraEdgeType.EXTENDS,
    )

    // Extract implements clauses
    this.extractHeritageQuery(
      language, tree, filePath, heritage,
      '(implements_clause (type_identifier) @iface)',
      AuraEdgeType.IMPLEMENTS,
    )
  }

  private extractHeritageQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    heritage: AuraEdge[],
    queryStr: string,
    edgeType: AuraEdgeType,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, queryStr)
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        const targetName = node.text

        // Only process captures matching the expected names
        if (name !== 'parent' && name !== 'iface') continue

        // Find the enclosing class name
        const className = this.findEnclosingClassName(node)
        const source = className ? `${filePath}:${className}` : filePath

        heritage.push({
          source,
          target: targetName,
          type: edgeType,
          confidence: 0.9,
          metadata: { rawTargetName: targetName },
        })
      }
    } finally {
      query.delete()
    }
  }

  private findEnclosingClassName(
    node: { parent: { type: string; parent: unknown } | null },
  ): string | null {
    let current = node.parent
    while (current) {
      const nodeType = (current as { type: string }).type
      if (nodeType === 'class_declaration') {
        const nameNode = (current as { child: (i: number) => { text: string } }).child(1)
        return nameNode?.text ?? null
      }
      if (nodeType === 'class_definition') {
        const nameNode = (current as { childForFieldName: (name: string) => { text: string } | null }).childForFieldName('name')
        return nameNode?.text ?? null
      }
      current = (current as { parent: { type: string; parent: unknown } | null }).parent
    }
    return null
  }
}