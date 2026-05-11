import path from 'path'
import { Parser, Language, type Tree, type SyntaxNode } from 'web-tree-sitter'
import {
  AuraNodeKind,
  AuraEdgeType,
} from './types.ts'
import type {
  AuraNode,
  AuraEdge,
  GraphData,
  RouteMapResult,
  ResponseShapeField,
} from './types.ts'

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const TS_EXTENSIONS = new Set(['.ts', '.tsx'])
const PY_EXTENSIONS = new Set(['.py'])
const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all', 'use', 'head', 'options'])
const ROUTER_IDENTIFIERS = new Set(['app', 'router', 'server', 'api', 'route', 'rtr'])
const PY_ROUTER_IDENTIFIERS = new Set(['app', 'router', 'bp', 'blueprint', 'api', 'web'])

export class AuraApiAnalyzer {
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
        console.warn('tree-sitter-python.wasm not found; Python route detection disabled')
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

  analyze(
    graph: GraphData,
    projectPath: string,
    sourceCache: Map<string, string>,
  ): RouteMapResult {
    const routes: AuraNode[] = []
    const apiCalls: AuraNode[] = []
    const edges: AuraEdge[] = []
    const handlerNodes: AuraNode[] = []

    const fileNodes = graph.nodes.filter(n => n.kind === AuraNodeKind.File)
    const symbolIndex = this.buildSymbolIndex(graph)

    for (const fileNode of fileNodes) {
      const filePath = fileNode.id
      const source = sourceCache.get(filePath)
      if (!source) continue

      const language = this.selectLanguage(filePath)
      if (!language || !this.parser) continue

      this.parser.setLanguage(language)
      const tree = this.parser.parse(source)
      if (!tree) continue

      // Detect Express/Node route registrations
      const routeResult = this.detectRouteRegistrations(filePath, tree.rootNode, source, graph, symbolIndex)
      routes.push(...routeResult.routes)
      edges.push(...routeResult.edges)
      handlerNodes.push(...routeResult.handlerNodes)

      // Detect fetch/axios/HTTP client calls
      const callResult = this.detectApiCalls(filePath, tree.rootNode, source, graph, symbolIndex)
      apiCalls.push(...callResult.apiCalls)
      edges.push(...callResult.edges)

      // Detect MCP tool definitions
      const toolResult = this.detectMcpTools(filePath, tree.rootNode, source, graph, symbolIndex)
      routes.push(...toolResult.tools)
      edges.push(...toolResult.edges)

      // Detect Python framework routes and API calls
      if (PY_EXTENSIONS.has(path.extname(filePath))) {
        const pyRouteResult = this.detectPythonRoutes(filePath, tree.rootNode, source, graph, symbolIndex)
        routes.push(...pyRouteResult.routes)
        edges.push(...pyRouteResult.edges)

        const pyCallResult = this.detectPythonApiCalls(filePath, tree.rootNode, source, graph, symbolIndex)
        apiCalls.push(...pyCallResult.apiCalls)
        edges.push(...pyCallResult.edges)
      }

      tree.delete()
    }

    // Match ApiCall nodes to Route nodes via FETCHES edges
    this.linkApiCallsToRoutes(apiCalls, routes, edges, graph, symbolIndex)

    return { routes, apiCalls, edges, handlerNodes }
  }

  // ── Route registration detection ──────────────────────────────────────────

  private detectRouteRegistrations(
    filePath: string,
    root: SyntaxNode,
    source: string,
    graph: GraphData,
    symbolIndex: Map<string, AuraNode[]>,
  ): { routes: AuraNode[]; edges: AuraEdge[]; handlerNodes: AuraNode[] } {
    const routes: AuraNode[] = []
    const edges: AuraEdge[] = []
    const handlerNodes: AuraNode[] = []
    const fileSymbols = symbolIndex.get(filePath) || []

    // Walk the tree looking for call_expressions
    const calls = this.findAllNodes(root, 'call_expression')

    for (const callExpr of calls) {
      const func = callExpr.childForFieldName('function')
      if (!func) continue

      // Match: obj.method(args) — e.g., app.get('/path', handler)
      if (func.type === 'member_expression') {
        const obj = func.childForFieldName('object')
        const prop = func.childForFieldName('property')
        if (!obj || !prop) continue

        const method = prop.text.toLowerCase()
        if (!HTTP_METHODS.has(method)) continue

        const objName = obj.text
        // Only process if the object looks like a router/express app
        if (!this.isRouterObject(objName, filePath, source)) continue

        const args = callExpr.childForFieldName('arguments')
        if (!args) continue

        const argList = this.getArgumentList(args)

        // First string argument is the route path
        const pathArg = argList.find(a => a.type === 'string' || a.type === 'template_string')
        if (!pathArg) continue

        const routePath = this.extractStringValue(pathArg)
        if (!routePath) continue

        const httpMethod = method.toUpperCase()

        // Create Route node
        const routeId = `${filePath}:${httpMethod} ${routePath}`
        const startLine = callExpr.startPosition.row + 1
        const endLine = callExpr.endPosition.row + 1

        const handlerInfo = this.extractHandlerInfo(argList, pathArg, fileSymbols, filePath)
        const middlewareInfo = this.extractMiddlewareInfo(argList, pathArg, handlerInfo, fileSymbols, filePath)

        // Extract response shape from handler if inline
        const responseShape = handlerInfo.isInline && handlerInfo.range
          ? this.extractResponseShape(
              source,
              handlerInfo.range.startLine,
              handlerInfo.range.endLine,
            )
          : []

        const routeNode: AuraNode = {
          id: routeId,
          kind: AuraNodeKind.Route,
          name: `${httpMethod} ${routePath}`,
          filePath,
          range: { startLine, endLine },
          exported: false,
          metadata: {
            method: httpMethod,
            path: routePath,
            handlerName: handlerInfo.name,
            handlerNodeId: handlerInfo.nodeId,
            handlerRange: handlerInfo.range,
            middleware: middlewareInfo,
            responseShape,
          },
        }
        routes.push(routeNode)

        // CONTAINS edge: File → Route
        edges.push({
          source: filePath,
          target: routeId,
          type: AuraEdgeType.CONTAINS,
          confidence: 1.0,
        })

        // HANDLES edge: handler function → Route
        if (handlerInfo.nodeId) {
          edges.push({
            source: handlerInfo.nodeId,
            target: routeId,
            type: AuraEdgeType.HANDLES,
            confidence: 0.95,
          })
        } else if (handlerInfo.isInline && handlerInfo.range) {
          // Inline handler — create a synthetic Function node and HANDLES edge
          const handlerId = `${filePath}:${handlerInfo.range.startLine}-${handlerInfo.range.endLine}:handler`
          handlerNodes.push({
            id: handlerId,
            kind: AuraNodeKind.Function,
            name: `${handlerInfo.name} (inline)`,
            filePath,
            range: handlerInfo.range,
            exported: false,
          })
          edges.push({
            source: handlerId,
            target: routeId,
            type: AuraEdgeType.HANDLES,
            confidence: 0.8,
          })
        }

        // MIDDLEWARE edges
        for (const mw of middlewareInfo) {
          if (mw.nodeId) {
            edges.push({
              source: mw.nodeId,
              target: routeId,
              type: AuraEdgeType.MIDDLEWARE,
              confidence: 0.9,
            })
          }
        }
      }
    }

    return { routes, edges, handlerNodes }
  }

  // ── API call detection ────────────────────────────────────────────────────

  private detectApiCalls(
    filePath: string,
    root: SyntaxNode,
    source: string,
    graph: GraphData,
    symbolIndex: Map<string, AuraNode[]>,
  ): { apiCalls: AuraNode[]; edges: AuraEdge[] } {
    const apiCalls: AuraNode[] = []
    const edges: AuraEdge[] = []
    const fileSymbols = symbolIndex.get(filePath) || []

    const calls = this.findAllNodes(root, 'call_expression')

    for (const callExpr of calls) {
      const func = callExpr.childForFieldName('function')
      if (!func) continue

      let method = 'GET'
      let url = ''
      let client: string = 'unknown'
      let urlKind: 'literal' | 'template' | 'variable' | 'pattern' = 'literal'

      // Pattern 1: fetch(url, options)
      if (func.type === 'identifier' && func.text === 'fetch') {
        client = 'fetch'
        const args = callExpr.childForFieldName('arguments')
        if (!args) continue
        const argList = this.getArgumentList(args)

        const urlArg = argList[0]
        if (!urlArg) continue

        const extracted = this.extractUrlFromArg(urlArg)
        url = extracted.url
        urlKind = extracted.kind

        // Check second arg for method
        if (argList.length > 1 && argList[1].type === 'object') {
          const methodProp = this.findPropertyInObject(argList[1], 'method')
          if (methodProp) {
            method = this.extractStringValue(methodProp)?.toUpperCase() || 'GET'
          }
        }
      }
      // Pattern 2: axios.get(url), axios.post(url, data)
      else if (func.type === 'member_expression') {
        const obj = func.childForFieldName('object')
        const prop = func.childForFieldName('property')
        if (!obj || !prop) continue

        const objText = obj.text
        const propText = prop.text.toLowerCase()

        if (objText === 'axios' || this.isAxiosAlias(objText, filePath, source)) {
          if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(propText)) {
            client = 'axios'
            method = propText.toUpperCase()
            const args = callExpr.childForFieldName('arguments')
            if (!args) continue
            const argList = this.getArgumentList(args)
            const urlArg = argList[0]
            if (!urlArg) continue
            const extracted = this.extractUrlFromArg(urlArg)
            url = extracted.url
            urlKind = extracted.kind
          } else if (propText === 'request') {
            client = 'axios'
            const args = callExpr.childForFieldName('arguments')
            if (!args) continue
            const argList = this.getArgumentList(args)
            // axios.request({ url: '...', method: '...' })
            if (argList[0]?.type === 'object') {
              const urlProp = this.findPropertyInObject(argList[0], 'url')
              if (urlProp) {
                const extracted = this.extractUrlFromArg(urlProp)
                url = extracted.url
                urlKind = extracted.kind
              }
              const methodProp = this.findPropertyInObject(argList[0], 'method')
              if (methodProp) {
                method = this.extractStringValue(methodProp)?.toUpperCase() || 'GET'
              }
            }
          } else {
            continue
          }
        } else {
          continue
        }
      } else {
        continue
      }

      if (!url) continue

      // Skip non-API URLs (absolute URLs to external services, data: URIs, etc.)
      if (url.startsWith('data:') || url.startsWith('blob:')) continue

      const startLine = callExpr.startPosition.row + 1
      const endLine = callExpr.endPosition.row + 1

      // Resolve enclosing symbol
      const enclosing = this.findEnclosingSymbol(startLine, endLine, fileSymbols)

      const callId = `${filePath}:${startLine}:${method}:${url}`

      // Extract consumer accessed fields
      const accessedFields = this.extractConsumerAccesses(callExpr, source)

      const apiCallNode: AuraNode = {
        id: callId,
        kind: AuraNodeKind.ApiCall,
        name: `${client}.${method.toLowerCase()}(${url})`,
        filePath,
        range: { startLine, endLine },
        exported: false,
        metadata: {
          method,
          url,
          urlKind,
          client,
          consumerSymbol: enclosing?.id || null,
          accessedFields,
        },
      }
      apiCalls.push(apiCallNode)

      // CONTAINS edge: File → ApiCall
      edges.push({
        source: filePath,
        target: callId,
        type: AuraEdgeType.CONTAINS,
        confidence: 1.0,
      })

      // If we have an enclosing symbol, create a FETCHES edge from it
      if (enclosing) {
        edges.push({
          source: enclosing.id,
          target: callId,
          type: AuraEdgeType.FETCHES,
          confidence: 0.8,
        })
      }
    }

    return { apiCalls, edges }
  }

  // ── MCP tool detection ───────────────────────────────────────────────────

  private detectMcpTools(
    filePath: string,
    root: SyntaxNode,
    source: string,
    graph: GraphData,
    symbolIndex: Map<string, AuraNode[]>,
  ): { tools: AuraNode[]; edges: AuraEdge[] } {
    const tools: AuraNode[] = []
    const edges: AuraEdge[] = []
    const fileSymbols = symbolIndex.get(filePath) || []

    const calls = this.findAllNodes(root, 'call_expression')

    for (const callExpr of calls) {
      const func = callExpr.childForFieldName('function')
      if (!func || func.type !== 'member_expression') continue

      const prop = func.childForFieldName('property')
      if (!prop) continue

      const methodText = prop.text
      if (methodText !== 'tool' && methodText !== 'resource' && methodText !== 'prompt') continue

      const args = callExpr.childForFieldName('arguments')
      if (!args) continue
      const argList = this.getArgumentList(args)

      // First argument should be the tool name (string)
      const nameArg = argList[0]
      if (!nameArg || nameArg.type !== 'string') continue

      const toolName = this.extractStringValue(nameArg)
      if (!toolName) continue

      const startLine = callExpr.startPosition.row + 1
      const endLine = callExpr.endPosition.row + 1

      // Find handler (last function argument)
      const handlerArg = [...argList].reverse().find(a =>
        a.type === 'arrow_function' || a.type === 'function_expression'
      )

      let description: string | null = null
      // Second argument might be a description string or schema
      if (argList.length >= 2 && argList[1].type === 'string') {
        description = this.extractStringValue(argList[1])
      }

      const toolId = `${filePath}:${methodText}:${toolName}`

      const toolNode: AuraNode = {
        id: toolId,
        kind: AuraNodeKind.Route,
        name: `${methodText}(${toolName})`,
        filePath,
        range: { startLine, endLine },
        exported: false,
        metadata: {
          toolType: 'mcp',
          mcpKind: methodText,
          toolName,
          description,
          handlerName: handlerArg ? 'anonymous' : null,
          handlerRange: handlerArg
            ? { startLine: handlerArg.startPosition.row + 1, endLine: handlerArg.endPosition.row + 1 }
            : null,
        },
      }
      tools.push(toolNode)

      edges.push({
        source: filePath,
        target: toolId,
        type: AuraEdgeType.CONTAINS,
        confidence: 1.0,
      })

      // HANDLES edge from enclosing symbol
      const enclosing = this.findEnclosingSymbol(startLine, endLine, fileSymbols)
      if (enclosing) {
        edges.push({
          source: enclosing.id,
          target: toolId,
          type: AuraEdgeType.HANDLES,
          confidence: 0.9,
        })
      }
    }

    return { tools, edges }
  }

  // ── Link API calls to routes ─────────────────────────────────────────────

  private linkApiCallsToRoutes(
    apiCalls: AuraNode[],
    routes: AuraNode[],
    edges: AuraEdge[],
    graph: GraphData,
    symbolIndex: Map<string, AuraNode[]>,
  ): void {
    const routeIndex = new Map<string, AuraNode>()
    for (const route of routes) {
      const meta = route.metadata as Record<string, unknown> | undefined
      if (meta?.toolType === 'mcp') continue
      const routePath = meta?.path as string | undefined
      if (routePath) {
        routeIndex.set(routePath, route)
        // Also index without leading slash variants
        const normalized = routePath.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
        routeIndex.set(normalized, route)
      }
    }

    for (const apiCall of apiCalls) {
      const meta = apiCall.metadata as Record<string, unknown> | undefined
      const url = meta?.url as string | undefined
      if (!url) continue

      // Try to match the URL to a known route
      const matchedRoute = this.matchUrlToRoute(url, routeIndex)
      if (matchedRoute) {
        // Create FETCHES edge from ApiCall to Route
        edges.push({
          source: apiCall.id,
          target: matchedRoute.id,
          type: AuraEdgeType.FETCHES,
          confidence: 0.8,
        })
      }
    }
  }

  // ── Response shape extraction ─────────────────────────────────────────────

  private extractResponseShape(
    source: string,
    startLine: number,
    endLine: number,
  ): ResponseShapeField[] {
    const fields: ResponseShapeField[] = []
    const lines = source.split('\n')
    const relevantLines = lines.slice(startLine - 1, endLine)
    const body = relevantLines.join('\n')

    // Pattern: res.json({ key1: val1, key2: val2 })
    const jsonMatch = body.match(/res(?:ponse)?\.json\s*\(\s*(\{[\s\S]*?\})\s*\)/)
    if (jsonMatch) {
      const objBody = jsonMatch[1]
      this.extractObjectKeys(objBody, fields, 'res_json')
    }

    // Pattern: return { key1: val1, key2: val2 }
    const returnMatch = body.match(/return\s+(\{[\s\S]*?\})\s*[;\n]/)
    if (returnMatch && fields.length === 0) {
      this.extractObjectKeys(returnMatch[1], fields, 'response_literal')
    }

    return fields
  }

  // ── Consumer access extraction ────────────────────────────────────────────

  private extractConsumerAccesses(
    callExpr: SyntaxNode,
    source: string,
  ): string[] {
    const fields: string[] = []

    // Walk siblings and parent scope after the call for property accesses
    // Look for patterns like: response.data.field, const { field } = data, data?.field
    const startLine = callExpr.startPosition.row + 1
    const endLine = Math.min(callExpr.endPosition.row + 10, source.split('\n').length)
    const lines = source.split('\n').slice(startLine - 1, endLine)
    const subsequent = lines.join('\n')

    // Pattern: variable.property or variable?.property
    const propAccessRegex = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*\w+(?:\.\w+)*(?:\s|$|;)/g
    let match: RegExpExecArray | null
    while ((match = propAccessRegex.exec(subsequent)) !== null) {
      const destructured = match[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean)
      fields.push(...destructured)
    }

    // Pattern: .property accesses on response-like variables
    const dotAccessRegex = /(\w+)\.(\w+)/g
    while ((match = dotAccessRegex.exec(subsequent)) !== null) {
      const prop = match[2]
      if (!['json', 'data', 'then', 'catch', 'status', 'ok', 'headers', 'text', 'blob', 'arrayBuffer'].includes(prop)) {
        if (!fields.includes(prop)) {
          fields.push(prop)
        }
      }
    }

    return [...new Set(fields)]
  }

  // ── Python route detection ──────────────────────────────────────────────────

  private detectPythonRoutes(
    filePath: string,
    root: SyntaxNode,
    source: string,
    graph: GraphData,
    symbolIndex: Map<string, AuraNode[]>,
  ): { routes: AuraNode[]; edges: AuraEdge[] } {
    const routes: AuraNode[] = []
    const edges: AuraEdge[] = []
    const fileSymbols = symbolIndex.get(filePath) || []
    const decorators = this.findAllNodes(root, 'decorator')

    for (const deco of decorators) {
      // In tree-sitter-python, decorators are children of decorated_definition.
      // Walk up to the parent, then find the function_definition child.
      let funcNode: SyntaxNode | null = null
      const parent = deco.parent
      if (parent && parent.type === 'decorated_definition') {
        for (let i = 0; i < parent.childCount; i++) {
          const child = parent.child(i)
          if (child && child.type === 'function_definition') {
            funcNode = child
            break
          }
        }
      }
      if (!funcNode) continue

      // Parse decorator: @app.route('/path'), @router.get('/path'), etc.
      const decoCall = this.parsePythonDecorator(deco)
      if (!decoCall) continue

      const { objectName, methodName, arguments: args } = decoCall

      // Check if the object is a known router identifier
      if (!this.isPythonRouterObject(objectName, filePath, source)) continue

      let routePath: string | null = null
      let httpMethod = 'GET'

      if (methodName === 'route') {
        // Flask pattern: @app.route('/path') or @app.route('/path', methods=['POST'])
        routePath = args[0] ?? null
        // Check for methods keyword argument
        const methodsArg = this.findKwargInDecorator(deco, 'methods')
        if (methodsArg && methodsArg.length > 0) {
          httpMethod = methodsArg[0].toUpperCase()
        } else {
          httpMethod = 'GET'
        }
      } else if (HTTP_METHODS.has(methodName)) {
        // FastAPI/Flask method decorator: @router.get('/path'), @app.post('/path')
        routePath = args[0] ?? null
        httpMethod = methodName.toUpperCase()
      } else {
        continue
      }

      if (!routePath) continue

      // Find handler function
      const handlerName = funcNode.childForFieldName('name')?.text ?? 'unknown'
      const handlerNode = fileSymbols.find(s => s.name === handlerName)
      const startLine = deco.startPosition.row + 1
      const endLine = funcNode.endPosition.row + 1

      const routeId = `${filePath}:${httpMethod} ${routePath}`
      const routeNode: AuraNode = {
        id: routeId,
        kind: AuraNodeKind.Route,
        name: `${httpMethod} ${routePath}`,
        filePath,
        range: { startLine, endLine },
        exported: false,
        metadata: {
          method: httpMethod,
          path: routePath,
          handlerName,
          handlerNodeId: handlerNode?.id ?? null,
          handlerRange: handlerNode?.range ?? { startLine: funcNode.startPosition.row + 1, endLine: funcNode.endPosition.row + 1 },
          middleware: [],
          responseShape: [],
        },
      }
      routes.push(routeNode)

      edges.push({
        source: filePath,
        target: routeId,
        type: AuraEdgeType.CONTAINS,
        confidence: 1.0,
      })

      if (handlerNode) {
        edges.push({
          source: handlerNode.id,
          target: routeId,
          type: AuraEdgeType.HANDLES,
          confidence: 0.95,
        })
      }
    }

    // Django URL patterns in urls.py files
    if (filePath.endsWith('urls.py')) {
      const djangoRoutes = this.detectDjangoRoutes(filePath, root, source, graph, symbolIndex, fileSymbols)
      routes.push(...djangoRoutes.routes)
      edges.push(...djangoRoutes.edges)
    }

    return { routes, edges }
  }

  private parsePythonDecorator(
    deco: SyntaxNode,
  ): { objectName: string; methodName: string; arguments: string[] } | null {
    // Decorators look like: @app.route('/path'), @router.get('/path'), @app.route('/path', methods=['POST'])
    // In tree-sitter-python: (decorator (call_expression ...))
    // Or just: @app.route without call — skip those
    for (let i = 0; i < deco.childCount; i++) {
      const child = deco.child(i)
      if (!child) continue

      if (child.type === 'call') {
        const func = child.childForFieldName('function')
        if (!func) continue

        // Extract object.method or just method
        let objectName = ''
        let methodName = ''

        if (func.type === 'attribute') {
          const obj = func.childForFieldName('object')
          const attr = func.childForFieldName('attribute')
          if (!obj || !attr) continue
          objectName = obj.text
          methodName = attr.text
        } else if (func.type === 'identifier') {
          methodName = func.text
        } else {
          continue
        }

        // Extract string arguments
        const args: string[] = []
        const argsNode = child.childForFieldName('arguments')
        if (argsNode) {
          for (let j = 0; j < argsNode.childCount; j++) {
            const arg = argsNode.child(j)
            if (!arg) continue
            if (arg.type === 'string' || arg.type === 'concatenated_string') {
              const val = this.extractPythonStringValue(arg)
              if (val) args.push(val)
            }
          }
        }

        return { objectName, methodName, arguments: args }
      }
    }
    return null
  }

  private findKwargInDecorator(deco: SyntaxNode, kwargName: string): string[] | null {
    // Find methods=['POST'] in @app.route('/path', methods=['POST'])
    for (let i = 0; i < deco.childCount; i++) {
      const child = deco.child(i)
      if (!child || child.type !== 'call') continue

      const argsNode = child.childForFieldName('arguments')
      if (!argsNode) continue

      for (let j = 0; j < argsNode.childCount; j++) {
        const arg = argsNode.child(j)
        if (!arg || arg.type !== 'keyword_argument') continue

        const kwName = arg.childForFieldName('name')
        if (!kwName || kwName.text !== kwargName) continue

        // Extract list values
        const kwValue = arg.childForFieldName('value')
        if (!kwValue || kwValue.type !== 'list') {
          // Single string value
          if (kwValue && kwValue.type === 'string') {
            const val = this.extractPythonStringValue(kwValue)
            return val ? [val] : null
          }
          continue
        }

        const methods: string[] = []
        for (let k = 0; k < kwValue.childCount; k++) {
          const item = kwValue.child(k)
          if (item && item.type === 'string') {
            const val = this.extractPythonStringValue(item)
            if (val) methods.push(val)
          }
        }
        return methods
      }
    }
    return null
  }

  private isPythonRouterObject(objName: string, filePath: string, source: string): boolean {
    if (PY_ROUTER_IDENTIFIERS.has(objName)) return true

    // Check source for Flask/FastAPI router patterns
    const lines = source.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.includes(objName) && (
        trimmed.includes('Flask(') ||
        trimmed.includes('FastAPI(') ||
        trimmed.includes('APIRouter(') ||
        trimmed.includes('Blueprint(')
      )) {
        return true
      }
    }
    return false
  }

  private extractPythonStringValue(node: SyntaxNode): string | null {
    if (node.type === 'string') {
      // tree-sitter-python string: (string (string_start) (string_content) (string_end))
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.type === 'string_content') {
          return child.text
        }
      }
      // Fallback: strip quotes
      const text = node.text
      return text.replace(/^['"]{1,3}|['"]{1,3}$/g, '')
    }
    if (node.type === 'concatenated_string') {
      let result = ''
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.type === 'string_content') {
          result += child.text
        }
      }
      return result || null
    }
    return node.text
  }

  private detectDjangoRoutes(
    filePath: string,
    root: SyntaxNode,
    source: string,
    graph: GraphData,
    symbolIndex: Map<string, AuraNode[]>,
    fileSymbols: AuraNode[],
  ): { routes: AuraNode[]; edges: AuraEdge[] } {
    const routes: AuraNode[] = []
    const edges: AuraEdge[] = []

    // Django: path('admin/', admin.site.urls) or path('articles/<int:year>/', views.year_archive)
    const calls = this.findAllNodes(root, 'call')
    for (const callExpr of calls) {
      const func = callExpr.childForFieldName('function')
      if (!func) continue

      const funcName = func.type === 'identifier' ? func.text :
                       func.type === 'attribute' ? func.childForFieldName('attribute')?.text : null
      if (funcName !== 'path' && funcName !== 're_path' && funcName !== 'url') continue

      const argsNode = callExpr.childForFieldName('arguments')
      if (!argsNode) continue

      const argList = this.getArgumentList(argsNode)
      if (argList.length < 2) continue

      // First argument is the URL pattern
      const pathArg = argList[0]
      let routePath = this.extractPythonStringValue(pathArg)
      if (!routePath) continue

      // Convert Django URL patterns to Express-style: <int:year> → :year
      routePath = routePath.replace(/<\w+:(\w+)>/g, ':$1').replace(/<(\w+)>/g, ':$1')

      // Second argument is the view function reference
      const viewArg = argList[1]
      const handlerName = viewArg.type === 'identifier' ? viewArg.text :
                          viewArg.type === 'attribute' ? viewArg.text : 'unknown'
      const handlerNode = fileSymbols.find(s => s.name === handlerName)

      const httpMethod = 'GET' // Django defaults to GET
      const startLine = callExpr.startPosition.row + 1
      const endLine = callExpr.endPosition.row + 1

      const routeId = `${filePath}:${httpMethod} ${routePath}`
      routes.push({
        id: routeId,
        kind: AuraNodeKind.Route,
        name: `${httpMethod} ${routePath}`,
        filePath,
        range: { startLine, endLine },
        exported: false,
        metadata: {
          method: httpMethod,
          path: routePath,
          handlerName,
          handlerNodeId: handlerNode?.id ?? null,
          middleware: [],
          responseShape: [],
        },
      })

      edges.push({
        source: filePath,
        target: routeId,
        type: AuraEdgeType.CONTAINS,
        confidence: 1.0,
      })

      if (handlerNode) {
        edges.push({
          source: handlerNode.id,
          target: routeId,
          type: AuraEdgeType.HANDLES,
          confidence: 0.9,
        })
      }
    }

    return { routes, edges }
  }

  private detectPythonApiCalls(
    filePath: string,
    root: SyntaxNode,
    source: string,
    graph: GraphData,
    symbolIndex: Map<string, AuraNode[]>,
  ): { apiCalls: AuraNode[]; edges: AuraEdge[] } {
    const apiCalls: AuraNode[] = []
    const edges: AuraEdge[] = []
    const fileSymbols = symbolIndex.get(filePath) || []

    const calls = this.findAllNodes(root, 'call')

    for (const callExpr of calls) {
      const func = callExpr.childForFieldName('function')
      if (!func || func.type !== 'attribute') continue

      const obj = func.childForFieldName('object')
      const prop = func.childForFieldName('attribute')
      if (!obj || !prop) continue

      const objText = obj.text
      const propText = prop.text.toLowerCase()

      let method = 'GET'
      let url = ''
      let client = 'unknown'
      let urlKind: 'literal' | 'template' | 'variable' | 'pattern' = 'literal'

      // requests.get('url'), requests.post('url', data=...)
      // httpx.get('url'), httpx.post('url')
      if (objText === 'requests' || objText === 'httpx' || this.isHttpClientAlias(objText, filePath, source)) {
        if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(propText)) {
          client = objText === 'httpx' ? 'httpx' : 'requests'
          method = propText.toUpperCase()

          const argsNode = callExpr.childForFieldName('arguments')
          if (!argsNode) continue
          const argList = this.getArgumentList(argsNode)
          if (argList.length < 1) continue

          const urlArg = argList[0]
          if (urlArg.type === 'string' || urlArg.type === 'concatenated_string') {
            const extracted = this.extractPythonStringValue(urlArg)
            url = extracted ?? ''
            urlKind = 'literal'
          } else {
            url = urlArg.text
            urlKind = 'variable'
          }
        } else if (propText === 'request') {
          // requests.request('GET', url) or httpx.request('GET', url)
          client = objText === 'httpx' ? 'httpx' : 'requests'
          const argsNode = callExpr.childForFieldName('arguments')
          if (!argsNode) continue
          const argList = this.getArgumentList(argsNode)
          if (argList.length >= 2) {
            const methodArg = argList[0]
            if (methodArg.type === 'string') {
              method = this.extractPythonStringValue(methodArg)?.toUpperCase() ?? 'GET'
            }
            const urlArg = argList[1]
            if (urlArg.type === 'string' || urlArg.type === 'concatenated_string') {
              url = this.extractPythonStringValue(urlArg) ?? ''
            } else {
              url = urlArg.text
              urlKind = 'variable'
            }
          }
        } else {
          continue
        }
      } else {
        continue
      }

      if (!url) continue
      if (url.startsWith('data:') || url.startsWith('blob:')) continue

      const startLine = callExpr.startPosition.row + 1
      const endLine = callExpr.endPosition.row + 1
      const enclosing = this.findEnclosingSymbol(startLine, endLine, fileSymbols)

      const callId = `${filePath}:${startLine}:${method}:${url}`
      apiCalls.push({
        id: callId,
        kind: AuraNodeKind.ApiCall,
        name: `${client}.${method.toLowerCase()}(${url})`,
        filePath,
        range: { startLine, endLine },
        exported: false,
        metadata: {
          method,
          url,
          urlKind,
          client,
          consumerSymbol: enclosing?.id || null,
          accessedFields: [],
        },
      })

      edges.push({
        source: filePath,
        target: callId,
        type: AuraEdgeType.CONTAINS,
        confidence: 1.0,
      })

      if (enclosing) {
        edges.push({
          source: enclosing.id,
          target: callId,
          type: AuraEdgeType.FETCHES,
          confidence: 0.8,
        })
      }
    }

    return { apiCalls, edges }
  }

  private isHttpClientAlias(objName: string, filePath: string, source: string): boolean {
    const lines = source.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.includes(objName) && (trimmed.includes('requests') || trimmed.includes('httpx'))) {
        return true
      }
    }
    return false
  }

  // ── Helper methods ───────────────────────────────────────────────────────

  private buildSymbolIndex(graph: GraphData): Map<string, AuraNode[]> {
    const index = new Map<string, AuraNode[]>()
    for (const node of graph.nodes) {
      if (node.kind === AuraNodeKind.File) continue
      const list = index.get(node.filePath) || []
      list.push(node)
      index.set(node.filePath, list)
    }
    return index
  }

  private selectLanguage(filePath: string): Language | null {
    const ext = path.extname(filePath)
    if (ext === '.tsx') return this.tsxLang
    if (ext === '.ts') return this.tsLang
    if (JS_EXTENSIONS.has(ext)) return this.jsLang
    if (PY_EXTENSIONS.has(ext)) return this.pyLang
    return null
  }

  private findAllNodes(node: SyntaxNode, type: string): SyntaxNode[] {
    const result: SyntaxNode[] = []
    const stack: SyntaxNode[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === type) {
        result.push(current)
      }
      for (let i = current.childCount - 1; i >= 0; i--) {
        stack.push(current.child(i))
      }
    }
    return result
  }

  private getArgumentList(argsNode: SyntaxNode): SyntaxNode[] {
    const args: SyntaxNode[] = []
    for (let i = 0; i < argsNode.childCount; i++) {
      const child = argsNode.child(i)
      if (child.type === ',' || child.type === '(' || child.type === ')') continue
      args.push(child)
    }
    return args
  }

  private extractStringValue(node: SyntaxNode): string | null {
    if (node.type === 'string') {
      // Remove quotes
      const text = node.text
      return text.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"')
    }
    if (node.type === 'template_string') {
      // Extract static part of template string
      let result = ''
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child.type === 'string_fragment') {
          result += child.text
        } else if (child.type === '${') {
          // Template interpolation — use placeholder
          result += '${...}'
        }
      }
      return result
    }
    if (node.type === 'property_identifier' || node.type === 'identifier') {
      return node.text
    }
    return null
  }

  private extractUrlFromArg(urlArg: SyntaxNode): { url: string; kind: 'literal' | 'template' | 'variable' | 'pattern' } {
    if (urlArg.type === 'string') {
      return { url: this.extractStringValue(urlArg) || '', kind: 'literal' }
    }
    if (urlArg.type === 'template_string') {
      return { url: this.extractStringValue(urlArg) || '', kind: 'template' }
    }
    // Variable reference or concatenation — extract what we can
    return { url: urlArg.text, kind: 'variable' }
  }

  private isRouterObject(objName: string, filePath: string, source: string): boolean {
    if (ROUTER_IDENTIFIERS.has(objName)) return true

    // Check if the variable was assigned from express.Router() or Router()
    const lines = source.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.includes(`${objName}`) && (trimmed.includes('Router()') || trimmed.includes('express()'))) {
        return true
      }
    }

    return false
  }

  private isAxiosAlias(objName: string, filePath: string, source: string): boolean {
    const lines = source.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.includes(objName) && trimmed.includes('axios')) {
        return true
      }
    }
    return false
  }

  private extractHandlerInfo(
    argList: SyntaxNode[],
    pathArg: SyntaxNode,
    fileSymbols: AuraNode[],
    filePath: string,
  ): { name: string; nodeId: string | null; range: { startLine: number; endLine: number } | null; isInline: boolean } {
    // Find the handler argument (first function arg after path, or last arg)
    for (let i = 0; i < argList.length; i++) {
      if (argList[i] === pathArg) {
        // Look for handler in subsequent args
        for (let j = i + 1; j < argList.length; j++) {
          const arg = argList[j]
          if (arg.type === 'arrow_function' || arg.type === 'function_expression') {
            const startLine = arg.startPosition.row + 1
            const endLine = arg.endPosition.row + 1
            return {
              name: 'anonymous',
              nodeId: null,
              range: { startLine, endLine },
              isInline: true,
            }
          }
          if (arg.type === 'identifier') {
            const handlerName = arg.text
            const handlerNode = fileSymbols.find(s => s.name === handlerName)
            return {
              name: handlerName,
              nodeId: handlerNode?.id || null,
              range: handlerNode?.range || null,
              isInline: false,
            }
          }
        }
      }
    }

    return { name: 'unknown', nodeId: null, range: null, isInline: false }
  }

  private extractMiddlewareInfo(
    argList: SyntaxNode[],
    pathArg: SyntaxNode,
    handlerInfo: { name: string; isInline: boolean },
    fileSymbols: AuraNode[],
    filePath: string,
  ): Array<{ name: string; filePath: string; range?: { startLine: number; endLine: number }; nodeId: string | null }> {
    const middleware: Array<{ name: string; filePath: string; range?: { startLine: number; endLine: number }; nodeId: string | null }> = []

    let foundPath = false
    for (const arg of argList) {
      if (arg === pathArg) {
        foundPath = true
        continue
      }
      if (!foundPath) continue

      // Skip the handler itself
      if (arg.type === 'arrow_function' || arg.type === 'function_expression') continue
      if (arg.type === 'identifier' && arg.text === handlerInfo.name) continue

      if (arg.type === 'identifier') {
        const mwName = arg.text
        const mwNode = fileSymbols.find(s => s.name === mwName)
        middleware.push({
          name: mwName,
          filePath,
          range: mwNode?.range,
          nodeId: mwNode?.id || null,
        })
      }
    }

    return middleware
  }

  private findEnclosingSymbol(
    startLine: number,
    endLine: number,
    fileSymbols: AuraNode[],
  ): AuraNode | null {
    let best: AuraNode | null = null
    let bestRange = Infinity

    for (const symbol of fileSymbols) {
      if (!symbol.range) continue
      if (startLine >= symbol.range.startLine && endLine <= symbol.range.endLine) {
        const range = symbol.range.endLine - symbol.range.startLine
        if (range < bestRange) {
          bestRange = range
          best = symbol
        }
      }
    }

    return best
  }

  private findPropertyInObject(objNode: SyntaxNode, propName: string): SyntaxNode | null {
    for (let i = 0; i < objNode.childCount; i++) {
      const child = objNode.child(i)
      if (child.type === 'pair') {
        const key = child.childForFieldName('key')
        if (key && (key.text === propName || key.text === `'${propName}'` || key.text === `"${propName}"`)) {
          return child.childForFieldName('value')
        }
      }
    }
    return null
  }

  private matchUrlToRoute(
    url: string,
    routeIndex: Map<string, AuraNode>,
  ): AuraNode | null {
    // Try exact match first
    let normalized = url.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    if (routeIndex.has(normalized)) return routeIndex.get(normalized)!

    // Try with template substitution: /api/aura/graph/${pid} → /api/aura/graph/:id
    const templatePattern = normalized.replace(/\$\{[^}]*\}/g, ':param')
    if (routeIndex.has(templatePattern)) return routeIndex.get(templatePattern)!

    // Try prefix matching: find the route whose path pattern matches the URL
    for (const [routePath, routeNode] of routeIndex) {
      const routeRegex = this.routePathToRegex(routePath)
      if (routeRegex && routeRegex.test(normalized)) return routeNode
    }

    return null
  }

  private routePathToRegex(routePath: string): RegExp | null {
    try {
      // Convert Express-style path params (:id) to regex
      const regexStr = routePath
        .replace(/:[\w]+/g, '[^/]+')
        .replace(/\//g, '\\/')
      return new RegExp(`^${regexStr}$`)
    } catch {
      return null
    }
  }

  private extractObjectKeys(objStr: string, fields: ResponseShapeField[], source: ResponseShapeField['source']): void {
    // Simple key extraction from object literal string
    // Matches: key: value, key: value (trailing comma optional)
    const keyRegex = /(?:^|,|{)\s*(\w+)\s*:/g
    let match: RegExpExecArray | null
    while ((match = keyRegex.exec(objStr)) !== null) {
      const key = match[1]
      // Infer type from value context
      const valueStart = objStr.substring(match.index + match[0].length).trimStart()
      let valueType = 'unknown'
      if (valueStart.startsWith("'") || valueStart.startsWith('"') || valueStart.startsWith('`')) {
        valueType = 'string'
      } else if (valueStart.startsWith('[')) {
        valueType = 'array'
      } else if (valueStart.startsWith('{')) {
        valueType = 'object'
      } else if (valueStart === 'true' || valueStart === 'false') {
        valueType = 'boolean'
      } else if (/^\d/.test(valueStart)) {
        valueType = 'number'
      } else if (valueStart.startsWith('null')) {
        valueType = 'null'
      }

      fields.push({ key, valueType, source, confidence: 0.8 })
    }
  }
}