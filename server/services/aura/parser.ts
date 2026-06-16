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

  // ── HTML parsing ───────────────────────────────────────────────────────────

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