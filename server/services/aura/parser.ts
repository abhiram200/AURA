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

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const TS_EXTENSIONS = new Set(['.ts', '.tsx'])
const PY_EXTENSIONS = new Set(['.py'])

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
    return null
  }

  isParsable(filePath: string): boolean {
    const ext = path.extname(filePath)
    return JS_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext) || PY_EXTENSIONS.has(ext)
  }

  shouldIgnore(dirName: string): boolean {
    return IGNORED_DIRS.has(dirName)
  }

  async parseFile(filePath: string, source: string): Promise<ParseResult> {
    // Route Python files to the Python parser
    if (PY_EXTENSIONS.has(path.extname(filePath))) {
      return this.parsePythonFile(filePath, source)
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

        imports.push({
          source: filePath,
          target: sourcePath,
          type: AuraEdgeType.IMPORTS,
          confidence: 1.0,
          metadata: {
            rawImportPath: sourcePath,
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