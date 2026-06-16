import { Query, type Language, type Tree } from 'web-tree-sitter'
import { AuraEdgeType } from './types.ts'
import type { AuraNode, AuraEdge } from './types.ts'
import { CSS_EXTENSIONS, SCSS_EXTENSIONS, HTML_EXTENSIONS, C_EXTENSIONS, CPP_EXTENSIONS, CSHARP_EXTENSIONS } from './extensions.ts'

type SyntaxNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  parent: SyntaxNode | null
  childCount: number
  child(i: number): SyntaxNode
  childForFieldName(name: string): SyntaxNode | null
}

export class AuraDataFlow {
  analyze(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    calls: AuraEdge[],
  ): AuraEdge[] {
    // Skip data flow analysis for non-executable file types (CSS/SCSS/HTML)
    const ext = filePath.substring(filePath.lastIndexOf('.'))
    if (CSS_EXTENSIONS.has(ext) || SCSS_EXTENSIONS.has(ext) || HTML_EXTENSIONS.has(ext) || C_EXTENSIONS.has(ext) || CPP_EXTENSIONS.has(ext) || CSHARP_EXTENSIONS.has(ext)) {
      return []
    }

    const edges: AuraEdge[] = []
    const seen = new Set<string>()

    const addEdge = (edge: AuraEdge): void => {
      const key = `${edge.source}→${edge.target}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push(edge)
      }
    }

    const isPython = filePath.endsWith('.py')

    this.extractParameterFlow(language, tree, filePath, symbols, calls, addEdge, isPython)
    this.extractReturnFlow(language, tree, filePath, symbols, addEdge, isPython)
    if (!isPython) {
      this.extractJsxPropFlow(language, tree, filePath, symbols, calls, addEdge)
    }
    this.extractAssignmentFlow(language, tree, filePath, symbols, addEdge, isPython)

    return edges
  }

  // ---------------------------------------------------------------------------
  // 1. Parameter flow (confidence 0.7)
  // ---------------------------------------------------------------------------
  private extractParameterFlow(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    calls: AuraEdge[],
    addEdge: (edge: AuraEdge) => void,
    isPython: boolean,
  ): void {
    // Only consider CALLS edges whose target has already been resolved to a
    // symbol ID (contains ':'). These represent calls where we know the callee.
    const resolvedCalls = calls.filter(
      (c) => c.type === AuraEdgeType.CALLS && c.target.includes(':'),
    )
    if (resolvedCalls.length === 0) return

    // Python uses 'call' and 'argument_list' instead of 'call_expression' and 'arguments'
    const argsQuery = isPython
      ? '(call arguments: (argument_list) @args)'
      : '(call_expression arguments: (arguments) @args)'

    let query: Query | null = null
    try {
      query = new Query(language, argsQuery)
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'args') continue

        // The call/call_expression is the parent of the arguments node
        const callExpr = node.parent as SyntaxNode | null
        if (!callExpr || (callExpr.type !== 'call_expression' && callExpr.type !== 'call')) continue

        // Get the function being called (the function node of call_expression)
        const funcNode = callExpr.childForFieldName('function')
        if (!funcNode) continue

        const callName = funcNode.text

        // Find the enclosing symbol of this call expression
        const enclosingId = this.findEnclosingSymbol(callExpr, symbols, filePath)

        // Find matching resolved CALLS edges for this call site
        // Match by call name and source (enclosing symbol or filePath)
        for (const callEdge of resolvedCalls) {
          const edgeSourceMatches = callEdge.source === enclosingId ||
            (enclosingId === filePath && callEdge.source === filePath)

          // Check if the call name matches the edge target or metadata
          const edgeCallName = callEdge.metadata?.callName as string | undefined
          const nameMatches = edgeCallName === callName ||
            callEdge.target.endsWith(':' + callName)

          if (edgeSourceMatches && nameMatches) {
            addEdge({
              source: enclosingId,
              target: callEdge.target,
              type: AuraEdgeType.FLOWS_TO,
              confidence: 0.7,
              metadata: { flowType: 'parameter' },
            })
          }
        }
      }
    } finally {
      query.delete()
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Return value flow (confidence 0.6)
  // ---------------------------------------------------------------------------
  private extractReturnFlow(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    addEdge: (edge: AuraEdge) => void,
    isPython: boolean,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, '(return_statement (identifier) @retval)')
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)
      for (const { name, node } of captures) {
        if (name !== 'retval') continue

        const returnedName = node.text
        const enclosingId = this.findEnclosingSymbol(node, symbols, filePath)

        // Resolve the returned identifier to a symbol if possible
        const resolvedTarget = this.resolveIdentifierToSymbol(
          returnedName,
          enclosingId,
          symbols,
          filePath,
        )

        addEdge({
          source: resolvedTarget,
          target: enclosingId,
          type: AuraEdgeType.FLOWS_TO,
          confidence: 0.6,
          metadata: { flowType: 'return', returnedIdentifier: returnedName },
        })
      }
    } finally {
      query.delete()
    }
  }

  // ---------------------------------------------------------------------------
  // 3. JSX prop flow (confidence 0.8)
  // ---------------------------------------------------------------------------
  private extractJsxPropFlow(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    calls: AuraEdge[],
    addEdge: (edge: AuraEdge) => void,
  ): void {
    // Filter to JSX-sourced calls only
    const jsxCalls = calls.filter(
      (c) =>
        c.type === AuraEdgeType.CALLS &&
        c.metadata?.callSource === 'jsx',
    )
    if (jsxCalls.length === 0) return

    let query: Query | null = null
    try {
      query = new Query(
        language,
        '(jsx_attribute (property_identifier) @propName (jsx_expression (identifier) @propValue))',
      )
    } catch {
      // TS grammar may not support jsx_attribute queries; skip gracefully
      return
    }

    try {
      const captures = query.captures(tree.rootNode)

      // Group captures by node so we can pair propName and propValue from
      // the same jsx_attribute
      const attrGroups = new Map<number, { propName?: string; propValue?: string; node: SyntaxNode }>()
      for (const { name, node } of captures) {
        // Walk up to find the jsx_attribute parent
        const attrNode = this.findAncestorByType(node, 'jsx_attribute')
        if (!attrNode) continue

        const nodeId = attrNode.startPosition.row * 10000 + attrNode.startPosition.column
        let group = attrGroups.get(nodeId)
        if (!group) {
          group = { node: attrNode }
          attrGroups.set(nodeId, group)
        }

        if (name === 'propName') {
          group.propName = node.text
        } else if (name === 'propValue') {
          group.propValue = node.text
        }
      }

      for (const [, group] of attrGroups) {
        if (!group.propName || !group.propValue) continue

        const propName = group.propName
        const propValue = group.propValue

        // Find the enclosing JSX element (opening or self-closing) to determine
        // which component is being referenced
        const jsxElement = this.findAncestorByType(
          group.node,
          'jsx_self_closing_element',
        ) ?? this.findAncestorByType(
          group.node,
          'jsx_opening_element',
        )
        if (!jsxElement) continue

        // Get the component name from the JSX element
        const nameNode = jsxElement.childForFieldName('name')
        const componentName = nameNode?.text
        if (!componentName) continue

        // Filter out lowercase (HTML intrinsic) component names
        if (componentName[0] === componentName[0].toLowerCase()) continue

        // Find the enclosing symbol of this JSX element
        const enclosingId = this.findEnclosingSymbol(jsxElement, symbols, filePath)

        // Find the matching JSX call edge
        const jsxCallEdge = jsxCalls.find((c) => {
          const callName = c.metadata?.callName as string | undefined
          return callName === componentName && c.source === enclosingId
        })

        // Resolve the prop value identifier to a symbol if possible
        const resolvedSource = this.resolveIdentifierToSymbol(
          propValue,
          enclosingId,
          symbols,
          filePath,
        )

        // The target is the component (from the call edge target, or the
        // component name if no resolved edge exists)
        const targetId = jsxCallEdge?.target ?? `${filePath}:${componentName}`

        addEdge({
          source: resolvedSource,
          target: targetId,
          type: AuraEdgeType.FLOWS_TO,
          confidence: 0.8,
          metadata: {
            flowType: 'jsx-prop',
            propName,
            propValue,
            componentName,
          },
        })
      }
    } finally {
      query.delete()
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Variable assignment flow (confidence 0.5)
  // ---------------------------------------------------------------------------
  private extractAssignmentFlow(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    addEdge: (edge: AuraEdge) => void,
    isPython: boolean,
  ): void {
    if (isPython) {
      // Python: x = y  (assignment)
      this.extractAssignmentQuery(
        language, tree, filePath, symbols, addEdge,
        '(assignment left: (identifier) @varName right: (identifier) @varValue)',
        'assignment',
      )
    } else {
      // JS/TS: const x = y
      this.extractAssignmentQuery(
        language, tree, filePath, symbols, addEdge,
        '(lexical_declaration (variable_declarator name: (identifier) @varName value: (identifier) @varValue))',
        'assignment',
      )

      // JS/TS: const x = () => { ... }
      this.extractAssignmentQuery(
        language, tree, filePath, symbols, addEdge,
        '(variable_declarator name: (identifier) @varName value: (arrow_function) @arrowFn)',
        'arrow-assignment',
      )
    }
  }

  private extractAssignmentQuery(
    language: Language,
    tree: Tree,
    filePath: string,
    symbols: AuraNode[],
    addEdge: (edge: AuraEdge) => void,
    queryStr: string,
    flowType: string,
  ): void {
    let query: Query | null = null
    try {
      query = new Query(language, queryStr)
    } catch {
      return
    }

    try {
      const captures = query.captures(tree.rootNode)

      // Group captures by their parent declarator
      const declGroups = new Map<number, { varName?: string; varValue?: string; arrowFn?: boolean }>()

      for (const { name, node } of captures) {
        // Find the parent variable_declarator
        const declNode = this.findAncestorByType(node, 'variable_declarator')
        if (!declNode) continue

        const nodeId = declNode.startPosition.row * 10000 + declNode.startPosition.column
        let group = declGroups.get(nodeId)
        if (!group) {
          group = {}
          declGroups.set(nodeId, group)
        }

        if (name === 'varName') {
          group.varName = node.text
        } else if (name === 'varValue') {
          group.varValue = node.text
        } else if (name === 'arrowFn') {
          group.arrowFn = true
          // Also capture the variable name from the parent declarator
          if (!group.varName) {
            const nameChild = declNode.childForFieldName('name')
            if (nameChild) {
              group.varName = nameChild.text
            }
          }
        }
      }

      for (const [, group] of declGroups) {
        if (!group.varName) continue

        const varName = group.varName
        const enclosingId = this.findEnclosingSymbol(
          // We don't have a direct reference to the node, so use the varName
          // to locate the enclosing symbol via position lookup. Instead, we
          // construct the target symbol ID.
          null,
          symbols,
          filePath,
        )

        // The target is the variable symbol
        const targetId = this.resolveIdentifierToSymbol(
          varName,
          enclosingId,
          symbols,
          filePath,
        )

        if (group.varValue) {
          // const x = y pattern: data flows from y to x
          const sourceId = this.resolveIdentifierToSymbol(
            group.varValue,
            enclosingId,
            symbols,
            filePath,
          )

          addEdge({
            source: sourceId,
            target: targetId,
            type: AuraEdgeType.FLOWS_TO,
            confidence: 0.5,
            metadata: { flowType: 'assignment', fromIdentifier: group.varValue, toIdentifier: varName },
          })
        } else if (group.arrowFn) {
          // const x = () => { ... } pattern: the enclosing context flows to x
          // This represents that data flows into the arrow function definition
          addEdge({
            source: enclosingId,
            target: targetId,
            type: AuraEdgeType.FLOWS_TO,
            confidence: 0.5,
            metadata: { flowType: 'assignment', isArrowFunction: true, toIdentifier: varName },
          })
        }
      }
    } finally {
      query.delete()
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: find the nearest enclosing symbol whose range contains the node
  // ---------------------------------------------------------------------------
  private findEnclosingSymbol(
    node: SyntaxNode | null,
    symbols: AuraNode[],
    filePath: string,
  ): string {
    if (!node) return filePath

    const nodeStartLine = node.startPosition.row + 1
    const nodeEndLine = node.endPosition.row + 1

    // Find the smallest (innermost) symbol that contains this node's position
    let bestMatch: AuraNode | null = null
    let bestRange = Infinity

    for (const symbol of symbols) {
      if (symbol.filePath !== filePath) continue
      if (!symbol.range) continue

      const symStart = symbol.range.startLine
      const symEnd = symbol.range.endLine

      // Check if the node is within the symbol's range
      if (nodeStartLine >= symStart && nodeEndLine <= symEnd) {
        const range = symEnd - symStart
        // Prefer the innermost (smallest range) symbol
        if (range < bestRange) {
          bestRange = range
          bestMatch = symbol
        }
      }
    }

    return bestMatch ? bestMatch.id : filePath
  }

  // ---------------------------------------------------------------------------
  // Helper: resolve an identifier text to a symbol ID, or fall back to a
  // plain identifier string if no matching symbol is found.
  // ---------------------------------------------------------------------------
  private resolveIdentifierToSymbol(
    identifierText: string,
    enclosingId: string,
    symbols: AuraNode[],
    filePath: string,
  ): string {
    // Try to find a symbol matching this identifier in the same file
    const sameFileSymbols = symbols.filter(
      (s) => s.filePath === filePath && s.name === identifierText,
    )

    if (sameFileSymbols.length > 0) {
      return sameFileSymbols[0].id
    }

    // Fall back: construct a symbol-style ID using the file path
    return `${filePath}:${identifierText}`
  }

  // ---------------------------------------------------------------------------
  // Helper: walk up the AST to find an ancestor of a given type
  // ---------------------------------------------------------------------------
  private findAncestorByType(
    node: SyntaxNode,
    type: string,
  ): SyntaxNode | null {
    let current = node.parent
    while (current) {
      if (current.type === type) {
        return current
      }
      current = current.parent
    }
    return null
  }
}