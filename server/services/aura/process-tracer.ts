import path from 'path'
import { Parser, Language, type SyntaxNode } from 'web-tree-sitter'
import { AuraNodeKind, AuraEdgeType } from './types.ts'
import type { AuraNode, AuraEdge, GraphData } from './types.ts'
import { JS_EXTENSIONS, TS_EXTENSIONS, PY_EXTENSIONS } from './extensions.ts'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all', 'use', 'head', 'options'])

// Built-in method names that should not be resolved to project symbols
const BUILTIN_METHODS = new Set([
  'get', 'set', 'has', 'delete', 'add', 'clear', 'entries', 'keys', 'values', 'forEach',
  'map', 'filter', 'reduce', 'find', 'findIndex', 'some', 'every', 'flat', 'flatMap',
  'includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'splice', 'concat', 'push', 'pop',
  'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin', 'from', 'of',
  'toString', 'valueOf', 'constructor',
  'then', 'catch', 'finally',
  'parse', 'stringify', 'assign', 'keys', 'values', 'entries', 'freeze', 'defineProperty',
  'bind', 'call', 'apply',
  'log', 'error', 'warn', 'info', 'debug',
  // Express/HTTP response methods commonly used in route handlers
  'status', 'json', 'send', 'end', 'redirect', 'render', 'set', 'header',
  'type', 'cookie', 'clearCookie', 'download', 'attachment', 'format',
  // Request object methods
  'param', 'query', 'body', 'params',
])

const PY_BUILTIN_METHODS = new Set([
  'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'index', 'count',
  'sort', 'reverse', 'copy', 'keys', 'values', 'items', 'get', 'update',
  'encode', 'decode', 'split', 'join', 'strip', 'lstrip', 'rstrip', 'replace',
  'upper', 'lower', 'title', 'capitalize', 'startswith', 'endswith', 'find',
  'format', 'startswith', 'endswith', 'center', 'ljust', 'rjust', 'zfill',
  '__init__', '__str__', '__repr__', '__len__', '__getitem__', '__setitem__',
  '__iter__', '__next__', '__eq__', '__hash__', '__call__', '__contains__',
  '__enter__', '__exit__',
])

export interface TraceResult {
  processNodes: AuraNode[]
  stepEdges: AuraEdge[]
  containsEdges: AuraEdge[]
  handlerNodes: AuraNode[]
}

export class ProcessTracer {
  private ready = false
  private parser: Parser | null = null
  private jsLang: Language | null = null
  private tsLang: Language | null = null
  private tsxLang: Language | null = null
  private pyLang: Language | null = null

  async init(): Promise<boolean> {
    try {
      await Parser.init()
      this.parser = new Parser()

      const grammarsDir = path.join(process.cwd(), 'server', 'grammars')
      this.jsLang = await Language.load(path.join(grammarsDir, 'tree-sitter-javascript.wasm'))
      this.tsLang = await Language.load(path.join(grammarsDir, 'tree-sitter-typescript.wasm'))
      this.tsxLang = await Language.load(path.join(grammarsDir, 'tree-sitter-tsx.wasm'))

      try {
        this.pyLang = await Language.load(path.join(grammarsDir, 'tree-sitter-python.wasm'))
      } catch {
        console.warn('tree-sitter-python.wasm not found; Python process tracing disabled')
      }

      this.ready = true
      return true
    } catch {
      return false
    }
  }

  isReady(): boolean {
    return this.ready
  }

  dispose(): void {
    this.parser?.delete()
    this.ready = false
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  trace(graph: GraphData, sourceCache: Map<string, string>): TraceResult {
    const processNodes: AuraNode[] = []
    const stepEdges: AuraEdge[] = []
    const containsEdges: AuraEdge[] = []
    const handlerNodes: AuraNode[] = []

    // Build lookup maps
    const nodeMap = new Map<string, AuraNode>()
    const outgoingEdges = new Map<string, AuraEdge[]>()
    const incomingEdges = new Map<string, AuraEdge[]>()
    const nodesByName = new Map<string, AuraNode[]>()

    // Populate node lookup first — import map needs nodeMap to resolve file paths
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node)
      if (!nodesByName.has(node.name)) nodesByName.set(node.name, [])
      nodesByName.get(node.name)!.push(node)
    }
    for (const edge of graph.edges) {
      if (!outgoingEdges.has(edge.source)) outgoingEdges.set(edge.source, [])
      if (!incomingEdges.has(edge.target)) incomingEdges.set(edge.target, [])
      outgoingEdges.get(edge.source)!.push(edge)
      incomingEdges.get(edge.target)!.push(edge)
    }

    // Build import map: file path → set of file paths it imports from
    const importMap = new Map<string, Set<string>>()
    for (const node of graph.nodes) {
      if (node.kind === AuraNodeKind.File && !importMap.has(node.id)) {
        importMap.set(node.id, new Set())
      }
    }
    for (const edge of graph.edges) {
      if (edge.type === AuraEdgeType.IMPORTS) {
        if (!importMap.has(edge.source)) importMap.set(edge.source, new Set())
        const targetNode = nodeMap.get(edge.target)
        if (targetNode) {
          importMap.get(edge.source)!.add(targetNode.filePath)
        }
      }
    }

    // Find all Route nodes
    const routeNodes = graph.nodes.filter(n => n.kind === AuraNodeKind.Route)

    for (const routeNode of routeNodes) {
      // Find handler via HANDLES edge (handler -> route, so handler is source)
      const handlesEdges = incomingEdges.get(routeNode.id)?.filter(e => e.type === AuraEdgeType.HANDLES) ?? []
      const middlewareEdges = incomingEdges.get(routeNode.id)?.filter(e => e.type === AuraEdgeType.MIDDLEWARE) ?? []

      // Get route metadata
      const method = (routeNode.metadata?.method as string) ?? 'get'
      const routePath = (routeNode.metadata?.path as string) ?? '/'
      const routeFilePath = routeNode.filePath
      const handlerName = (routeNode.metadata?.handlerName as string) ?? ''

      // Skip routes without a handler (e.g., app.use() for middleware mounting)
      if (handlerName === 'unknown') continue

      // Determine handler node and service calls
      let handlerNodeId: string | null = null
      let serviceCallNodeIds: string[] = []

      if (handlesEdges.length > 0) {
        // Named handler with HANDLES edge
        handlerNodeId = handlesEdges[0].source
        const handlerCalls = (outgoingEdges.get(handlerNodeId)?.filter(e => e.type === AuraEdgeType.CALLS) ?? [])
          .filter(e => {
            const target = nodeMap.get(e.target)
            return target && target.kind !== AuraNodeKind.ApiCall
          })
        serviceCallNodeIds = handlerCalls.map(e => e.target)
      } else {
        // Inline handler — trace calls from handler body via tree-sitter
        const inlineResult = this.traceInlineHandler(routeNode, sourceCache, nodesByName, nodeMap, importMap)
        if (inlineResult) {
          handlerNodeId = inlineResult.handlerNodeId
          serviceCallNodeIds = inlineResult.serviceCallNodeIds
          // Create a synthetic Function node for the inline handler
          handlerNodes.push({
            id: inlineResult.handlerNodeId,
            kind: AuraNodeKind.Function,
            name: `${handlerName || 'anonymous'} (inline)`,
            filePath: routeNode.filePath,
            range: inlineResult.handlerRange,
            exported: false,
          })
        }
      }

      if (!handlerNodeId) continue

      // Create Process node
      const processId = `${routeFilePath}:process:${method.toUpperCase()} ${routePath}`
      const processNode: AuraNode = {
        id: processId,
        kind: AuraNodeKind.Process,
        name: `${method.toUpperCase()} ${routePath} Flow`,
        filePath: routeFilePath,
        exported: false,
        metadata: {
          method,
          path: routePath,
          entryRouteId: routeNode.id,
        },
      }

      // Calculate total step count
      const stepCount = 1 + middlewareEdges.length + 1 + serviceCallNodeIds.length
      processNode.metadata!.stepCount = stepCount

      processNodes.push(processNode)
      containsEdges.push({
        source: routeFilePath,
        target: processId,
        type: AuraEdgeType.CONTAINS,
        confidence: 1.0,
      })

      let stepOrder = 0

      // Step: entry (Process -> Route)
      stepEdges.push({
        source: processId,
        target: routeNode.id,
        type: AuraEdgeType.STEP_IN_PROCESS,
        confidence: 1.0,
        metadata: { stepOrder: stepOrder++, stepLabel: 'entry' },
      })

      // Steps: middleware (Process -> middleware functions)
      for (const mwEdge of middlewareEdges) {
        const mwNode = nodeMap.get(mwEdge.source)
        if (mwNode) {
          stepEdges.push({
            source: processId,
            target: mwNode.id,
            type: AuraEdgeType.STEP_IN_PROCESS,
            confidence: 1.0,
            metadata: { stepOrder: stepOrder++, stepLabel: 'middleware' },
          })
        }
      }

      // Step: handler (Process -> handler function)
      stepEdges.push({
        source: processId,
        target: handlerNodeId,
        type: AuraEdgeType.STEP_IN_PROCESS,
        confidence: 1.0,
        metadata: { stepOrder: stepOrder++, stepLabel: 'handler' },
      })

      // Steps: service calls from handler (Process -> called functions)
      for (const callNodeId of serviceCallNodeIds) {
        stepEdges.push({
          source: processId,
          target: callNodeId,
          type: AuraEdgeType.STEP_IN_PROCESS,
          confidence: 1.0,
          metadata: { stepOrder: stepOrder++, stepLabel: 'service' },
        })
      }
    }

    return { processNodes, stepEdges, containsEdges, handlerNodes }
  }

  // ── Inline handler tracing ───────────────────────────────────────────────

  private traceInlineHandler(
    routeNode: AuraNode,
    sourceCache: Map<string, string>,
    nodesByName: Map<string, AuraNode[]>,
    nodeMap: Map<string, AuraNode>,
    importMap: Map<string, Set<string>>,
  ): { handlerNodeId: string; serviceCallNodeIds: string[]; handlerRange: { startLine: number; endLine: number } } | null {
    if (!this.parser || !this.tsLang) return null

    const source = sourceCache.get(routeNode.filePath)
    if (!source) return null

    const handlerName = (routeNode.metadata?.handlerName as string) ?? ''
    const handlerRange = routeNode.metadata?.handlerRange as { startLine: number; endLine: number } | undefined
    if (handlerName === 'unknown' || !handlerRange) return null

    // Parse the file
    const ext = path.extname(routeNode.filePath)
    let lang: Language | null
    if (PY_EXTENSIONS.has(ext)) {
      lang = this.pyLang
    } else if (TS_EXTENSIONS.has(ext)) {
      lang = this.tsLang
    } else if (JS_EXTENSIONS.has(ext)) {
      lang = this.jsLang
    } else {
      lang = this.tsxLang
    }
    if (!lang) return null
    this.parser.setLanguage(lang)

    const tree = this.parser.parse(source)
    if (!tree) return null

    // Find the inline handler function node at the route's line range
    const handlerNode = this.findFunctionAtRange(tree.rootNode, handlerRange.startLine, handlerRange.endLine)
    if (!handlerNode) {
      tree.delete()
      return null
    }

    // Create a synthetic handler node ID using the route's range
    const syntheticHandlerId = `${routeNode.filePath}:${handlerRange.startLine}-${handlerRange.endLine}:handler`

    // Scan handler body for call expressions and resolve to graph nodes
    const serviceCallNodeIds: string[] = []
    const calls = this.findCallsInNode(handlerNode)
    const routeImports = importMap.get(routeNode.filePath) ?? new Set<string>()

    // Build a receiver → class file mapping for receiver-aware resolution
    // e.g., "projectService" → look for "ProjectService" class, map to project.ts
    const receiverClassFiles = this.buildReceiverClassMap(nodesByName, routeNode.filePath, routeImports)

    for (const call of calls) {
      const candidates = nodesByName.get(call.method)
      if (!candidates || candidates.length === 0) continue
      // Filter out Variable nodes (not callable services) and ApiCall nodes
      const viable = candidates.filter(n =>
        n.kind !== AuraNodeKind.ApiCall && n.kind !== AuraNodeKind.Variable
      )
      if (viable.length === 0) continue

      // Resolution priority:
      // 1. Same file as the route
      // 2. Receiver-aware: match receiver name to class file
      // 3. File imported by the route file
      // 4. First viable candidate (fallback)
      const sameFile = viable.find(n => n.filePath === routeNode.filePath)
      if (sameFile) {
        serviceCallNodeIds.push(sameFile.id)
        continue
      }

      // Receiver-aware: if receiver like "projectService", find class "ProjectService" → prefer its file
      if (call.receiver && receiverClassFiles.has(call.receiver)) {
        const classFile = receiverClassFiles.get(call.receiver)!
        const receiverMatch = viable.find(n => n.filePath === classFile)
        if (receiverMatch) {
          serviceCallNodeIds.push(receiverMatch.id)
          continue
        }
      }

      const importedFile = viable.find(n => routeImports.has(n.filePath))
      if (importedFile) {
        serviceCallNodeIds.push(importedFile.id)
        continue
      }
      serviceCallNodeIds.push(viable[0].id)
    }

    tree.delete()
    return { handlerNodeId: syntheticHandlerId, serviceCallNodeIds, handlerRange }
  }

  private findFunctionAtRange(root: SyntaxNode, startLine: number, endLine: number): SyntaxNode | null {
    // Walk the tree to find a function at the given line range
    const stack: SyntaxNode[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      const nodeStart = node.startPosition.row + 1
      const nodeEnd = node.endPosition.row + 1

      if ((node.type === 'arrow_function' || node.type === 'function_expression' || node.type === 'function_definition') &&
          nodeStart === startLine && nodeEnd <= endLine + 1) {
        return node
      }

      for (const child of node.children) {
        stack.push(child)
      }
    }
    return null
  }

  private findCallsInNode(node: SyntaxNode): Array<{ method: string; receiver: string | null }> {
    const calls: Array<{ method: string; receiver: string | null }> = []
    const stack: SyntaxNode[] = [node]

    while (stack.length > 0) {
      const current = stack.pop()!

      if (current.type === 'call_expression' || current.type === 'call') {
        const func = current.childForFieldName('function')
        if (func) {
          const result = this.getCallTargetName(func)
          if (result) calls.push(result)
        }
      }

      for (const child of current.children) {
        stack.push(child)
      }
    }

    return calls
  }

  private getCallTargetName(node: SyntaxNode): { method: string; receiver: string | null } | null {
    if (node.type === 'identifier') {
      const name = node.text
      if (BUILTIN_METHODS.has(name) || PY_BUILTIN_METHODS.has(name)) return null
      return { method: name, receiver: null }
    }
    if (node.type === 'member_expression' || node.type === 'attribute') {
      // JS uses 'member_expression' with 'property', Python uses 'attribute' with 'attribute'
      const property = node.childForFieldName('property') ?? node.childForFieldName('attribute')
      const method = property?.text ?? null
      if (!method || BUILTIN_METHODS.has(method) || PY_BUILTIN_METHODS.has(method)) return null
      const object = node.childForFieldName('object')
      const receiver = object?.text ?? null
      return { method, receiver }
    }
    return null
  }

  // Build a map from variable-like receiver names to the file paths of their class
  // e.g., "projectService" (receiver) → "ProjectService" (class) → "server/services/project.ts" (file)
  private buildReceiverClassMap(
    nodesByName: Map<string, AuraNode[]>,
    routeFilePath: string,
    routeImports: Set<string>,
  ): Map<string, string> {
    const result = new Map<string, string>()

    // Find all Class nodes in imported files or the route file
    const classNodes = [...nodesByName.values()]
      .flat()
      .filter(n => n.kind === AuraNodeKind.Class)
      .filter(n => n.filePath === routeFilePath || routeImports.has(n.filePath))

    // For each class, create receiver-style aliases
    // e.g., "ProjectService" → check for "projectService", "ProjectService"
    for (const cls of classNodes) {
      const className = cls.name
      // camelCase version: "ProjectService" → "projectService"
      const camelName = className.charAt(0).toLowerCase() + className.slice(1)
      result.set(camelName, cls.filePath)
      result.set(className, cls.filePath)
      // snake_case version for Python: "ProjectService" → "project_service"
      const snakeName = className
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
      result.set(snakeName, cls.filePath)
    }

    return result
  }
}