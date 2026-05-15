import path from 'path'
import fs from 'fs'
import { Parser, Language, Query, type Tree } from 'web-tree-sitter'
import {
  SynapseNodeKind,
  SynapseEdgeType,
} from './types.ts'
import type {
  SynapseNode,
  SynapseEdge,
} from './types.ts'

export interface ParseResult {
  filePath: string
  symbols: SynapseNode[]
  imports: SynapseEdge[]
  calls: SynapseEdge[]
  heritage: SynapseEdge[]
  contains: SynapseEdge[]
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
  '.synapse',
  'out',
  '.cache',
  '.vscode',
  '.idea',
])

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const TS_EXTENSIONS = new Set(['.ts', '.tsx'])

export class SynapseParser {
  private ready = false
  private jsLang: Language | null = null
  private tsLang: Language | null = null
  private tsxLang: Language | null = null
  private parser: Parser | null = null

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
    return null
  }

  isParsable(filePath: string): boolean {
    const ext = path.extname(filePath)
    return JS_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext)
  }

  shouldIgnore(dirName: string): boolean {
    return IGNORED_DIRS.has(dirName)
  }

  async parseFile(filePath: string, source: string): Promise<ParseResult> {
    const language = this.selectLanguage(filePath)
    if (!language || !this.parser) {
      return { filePath, symbols: [], imports: [], calls: [], heritage: [], contains: [] }
    }

    this.parser.setLanguage(language)
    const tree = this.parser.parse(source)

    try {
      const symbols: SynapseNode[] = []
      const imports: SynapseEdge[] = []
      const calls: SynapseEdge[] = []
      const heritage: SynapseEdge[] = []
      const contains: SynapseEdge[] = []

      // Track symbol IDs to deduplicate
      const seenIds = new Set<string>()

      // Extract functions
      this.extractWithQuery(
        language, tree, filePath,
        '(function_declaration name: (identifier) @name)',
        SynapseNodeKind.Function,
        symbols, contains, seenIds,
      )

      // Extract arrow functions stored in variables
      this.extractWithQuery(
        language, tree, filePath,
        '(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))',
        SynapseNodeKind.Function,
        symbols, contains, seenIds,
      )

      // Extract classes
      this.extractWithQuery(
        language, tree, filePath,
        '(class_declaration name: (type_identifier) @name)',
        SynapseNodeKind.Class,
        symbols, contains, seenIds,
      )

      // Extract interfaces
      this.extractWithQuery(
        language, tree, filePath,
        '(interface_declaration name: (type_identifier) @name)',
        SynapseNodeKind.Interface,
        symbols, contains, seenIds,
      )

      // Extract type aliases
      this.extractWithQuery(
        language, tree, filePath,
        '(type_alias_declaration name: (type_identifier) @name)',
        SynapseNodeKind.TypeAlias,
        symbols, contains, seenIds,
      )

      // Extract methods
      this.extractWithQuery(
        language, tree, filePath,
        '(method_definition name: (property_identifier) @name)',
        SynapseNodeKind.Method,
        symbols, contains, seenIds,
      )

      // Extract method signatures (TS interfaces/abstract classes)
      this.extractWithQuery(
        language, tree, filePath,
        '(method_signature name: (property_identifier) @name)',
        SynapseNodeKind.Method,
        symbols, contains, seenIds,
      )

      // Extract variables (skip those already captured as arrow functions)
      this.extractWithQuery(
        language, tree, filePath,
        '(lexical_declaration (variable_declarator name: (identifier) @name))',
        SynapseNodeKind.Variable,
        symbols, contains, seenIds,
      )

      // Extract imports
      this.extractImports(language, tree, filePath, imports)

      // Extract call expressions
      this.extractCalls(language, tree, filePath, calls, symbols)

      // Extract heritage (extends/implements)
      this.extractHeritage(language, tree, filePath, heritage)

      return { filePath, symbols, imports, calls, heritage, contains }
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

  private extractWithQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    queryStr: string,
    kind: SynapseNodeKind,
    symbols: SynapseNode[],
    contains: SynapseEdge[],
    seenIds: Set<string>,
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

        const exported = this.isNodeExported(node)

        symbols.push({
          id: symbolId,
          kind,
          name: symbolName,
          filePath,
          range: {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          },
          exported,
        })

        contains.push({
          source: filePath,
          target: symbolId,
          type: SynapseEdgeType.CONTAINS,
          confidence: 1.0,
        })
      }
    } finally {
      query.delete()
    }
  }

  private isNodeExported(node: { parent: { type: string } | null }): boolean {
    let current: { parent: { type: string } | null } | null = node
    while (current) {
      if (current.parent && current.parent.type === 'export_statement') {
        return true
      }
      current = current.parent
    }
    return false
  }

  private extractImports(
    language: Language,
    tree: Tree,
    filePath: string,
    imports: SynapseEdge[],
  ): void {
    let query: Query | null = null
    try {
      // TypeScript uses import_statement, JavaScript also uses import_statement
      query = new Query(language, '(import_statement source: (string (string_fragment) @source))')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'source') continue
        const importPath = node.text

        imports.push({
          source: filePath,
          target: importPath,
          type: SynapseEdgeType.IMPORTS,
          confidence: 1.0,
          metadata: { rawImportPath: importPath },
        })
      }
    } finally {
      query.delete()
    }
  }

  private extractCalls(
    language: Language,
    tree: Tree,
    filePath: string,
    calls: SynapseEdge[],
    symbols: SynapseNode[],
  ): void {
    // Direct call expressions: function_name(args)
    this.extractCallQuery(
      language, tree, filePath, calls, symbols,
      '(call_expression function: (identifier) @name)',
    )

    // Method call expressions: obj.method(args)
    this.extractCallQuery(
      language, tree, filePath, calls, symbols,
      '(call_expression function: (member_expression property: (property_identifier) @method))',
    )
  }

  private extractCallQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    calls: SynapseEdge[],
    symbols: SynapseNode[],
    queryStr: string,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, queryStr)
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { node } of captures) {
        const callName = node.text

        // Find enclosing function/class to use as source
        const enclosingSymbol = this.findEnclosingSymbol(node, symbols)
        const source = enclosingSymbol ? enclosingSymbol.id : filePath

        calls.push({
          source,
          target: callName,
          type: SynapseEdgeType.CALLS,
          confidence: 0.7,
          metadata: { callName },
        })
      }
    } finally {
      query.delete()
    }
  }

  private findEnclosingSymbol(
    node: { parent: { type: string; parent: unknown } | null },
    symbols: SynapseNode[],
  ): SynapseNode | null {
    // Walk up the tree to find an enclosing function, method, or class
    let current = node.parent
    while (current) {
      const nodeType = (current as { type: string }).type
      if (
        nodeType === 'function_declaration' ||
        nodeType === 'method_definition' ||
        nodeType === 'class_declaration' ||
        nodeType === 'arrow_function'
      ) {
        // Try to find the name child of this node
        const nameNode = (current as { child: (i: number) => { text: string } }).child(1)
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
    heritage: SynapseEdge[],
  ): void {
    // Extract extends clauses
    this.extractHeritageQuery(
      language, tree, filePath, heritage,
      '(extends_clause value: (identifier) @parent)',
      SynapseEdgeType.EXTENDS,
    )

    // Extract implements clauses
    this.extractHeritageQuery(
      language, tree, filePath, heritage,
      '(implements_clause (type_identifier) @iface)',
      SynapseEdgeType.IMPLEMENTS,
    )
  }

  private extractHeritageQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    heritage: SynapseEdge[],
    queryStr: string,
    edgeType: SynapseEdgeType,
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
      current = (current as { parent: { type: string; parent: unknown } | null }).parent
    }
    return null
  }
}