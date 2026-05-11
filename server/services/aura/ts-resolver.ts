import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import {
  AuraNodeKind,
  AuraEdgeType,
} from './types.ts'
import type {
  AuraNode,
  AuraEdge,
  GraphData,
} from './types.ts'

interface ResolveResult {
  updatedEdges: AuraEdge[]
  newEdges: AuraEdge[]
  updatedNodes: AuraNode[]
}

export class AuraTsResolver {
  private program: any = null
  private checker: any = null
  private available = false

  async init(projectPath: string): Promise<boolean> {
    try {
      // Dynamic import of typescript — graceful degradation if not available
      const ts = await import('typescript')

      const tsconfigPath = ts.findConfigFile(projectPath, ts.sys.fileExists, 'tsconfig.json')
      if (!tsconfigPath) {
        return false
      }

      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
      if (configFile.error) {
        return false
      }

      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath),
      )

      // Be permissive — resolve as many types as possible, even in files with errors
      parsedConfig.options.noEmit = true
      parsedConfig.options.skipLibCheck = true
      parsedConfig.options.strict = false

      const host = ts.createCompilerHost(parsedConfig.options)
      this.program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options, host)
      this.checker = this.program.getTypeChecker()
      this.available = true
      return true
    } catch {
      // TypeScript not installed or tsconfig not found — skip type resolution
      return false
    }
  }

  resolve(graph: GraphData): ResolveResult {
    if (!this.available || !this.program || !this.checker) {
      return { updatedEdges: [], newEdges: [], updatedNodes: [] }
    }

    const result: ResolveResult = {
      updatedEdges: [],
      newEdges: [],
      updatedNodes: [],
    }

    const memberResult = this.resolveMemberCalls(graph)
    result.updatedEdges.push(...memberResult.updatedEdges)
    result.newEdges.push(...memberResult.newEdges)

    const implResult = this.resolveImplementations(graph)
    result.updatedEdges.push(...implResult.updatedEdges)
    result.newEdges.push(...implResult.newEdges)

    const reExportResult = this.resolveReExports(graph)
    result.updatedEdges.push(...reExportResult.updatedEdges)
    result.newEdges.push(...reExportResult.newEdges)

    const genericResult = this.resolveGenerics(graph)
    result.newEdges.push(...genericResult.newEdges)

    return result
  }

  dispose(): void {
    this.program = null
    this.checker = null
    this.available = false
  }

  // ── Member Call Resolution ──────────────────────────────────────────────────────
  // Resolves `obj.method()` calls by determining the type of `obj` and looking up
  // the method on that type. This is the highest-impact resolution — it turns the
  // majority of unresolved member calls into precise symbol references.

  private resolveMemberCalls(graph: GraphData): ResolveResult {
    const result: ResolveResult = { updatedEdges: [], newEdges: [], updatedNodes: [] }
    const ts = this.getTs()
    if (!ts || !this.checker) return result

    const nodeMap = new Map<string, AuraNode>()
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node)
    }

    for (const edge of graph.edges) {
      if (edge.type !== AuraEdgeType.CALLS) continue
      if (edge.metadata?.callTargetKind !== 'member') continue
      // Skip already-resolved edges (target is a node ID)
      if (nodeMap.has(edge.target)) continue

      const methodName = edge.metadata?.methodName as string | undefined
      const callName = edge.metadata?.callName as string | undefined
      if (!methodName) continue

      // Determine source file from edge source
      const colonIdx = edge.source.indexOf(':')
      const sourceFile = colonIdx >= 0 ? edge.source.substring(0, colonIdx) : edge.source
      const sourceSymbol = colonIdx >= 0 ? edge.source : null

      // Find the TypeScript source file
      const tsFile = this.findTsFile(sourceFile)
      if (!tsFile) continue

      // Try to find the call expression in the source file
      const resolved = this.resolveMemberCallInFile(tsFile, methodName, callName, sourceSymbol, sourceFile, nodeMap)
      if (resolved) {
        edge.target = resolved.targetId
        edge.confidence = resolved.confidence
        edge.metadata = {
          ...edge.metadata,
          typeResolution: 'ts-compiler',
        }
        result.updatedEdges.push(edge)

        // Create TYPEOF edge from calling symbol to the type declaration
        if (resolved.typeId) {
          result.newEdges.push({
            source: edge.source,
            target: resolved.typeId,
            type: AuraEdgeType.TYPEOF,
            confidence: 0.8,
            metadata: { resolvedFrom: 'member_call_type', typeName: resolved.typeName },
          })
        }
      }
    }

    return result
  }

  private resolveMemberCallInFile(
    tsFile: any,
    methodName: string,
    callName: string | undefined,
    sourceSymbol: string | null,
    sourceFile: string,
    nodeMap: Map<string, AuraNode>,
  ): { targetId: string; confidence: number; typeId?: string; typeName?: string } | null {
    const ts = this.getTs()
    if (!ts || !this.checker) return null

    // Walk the file looking for call expressions matching the method name
    let found: { targetId: string; confidence: number; typeId?: string; typeName?: string } | null = null

    const visit = (node: any) => {
      if (found) return

      if (ts.isCallExpression(node)) {
        const expr = node.expression
        if (ts.isPropertyAccessExpression(expr)) {
          const name = expr.name.getText(tsFile)
          if (name === methodName) {
            // Get the type of the object expression
            const objType = this.checker.getTypeAtLocation(expr.expression)
            if (objType) {
              // Look up the property on the type
              const prop = objType.getProperty(methodName)
              if (prop) {
                const decl = prop.valueDeclaration ?? prop.declarations?.[0]
                if (decl) {
                  const declFile = decl.getSourceFile().fileName
                  const declPath = path.relative(process.cwd(), declFile).replace(/\\/g, '/')
                  const declName = decl.name && ts.isIdentifier(decl.name) ? decl.name.getText(tsFile) : methodName

                  // Check if a graph node matches this declaration
                  const candidateId = `${declPath}:${declName}`
                  if (nodeMap.has(candidateId)) {
                    // Get the type name for TYPEOF edge
                    const typeName = this.checker.typeToString(objType)
                    const typeDecl = this.getTypeDeclarationId(objType, nodeMap)

                    found = {
                      targetId: candidateId,
                      confidence: 0.95,
                      typeId: typeDecl ?? undefined,
                      typeName,
                    }
                  }
                }
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    ts.forEachChild(tsFile, visit)
    return found
  }

  // ── Interface Implementation Resolution ──────────────────────────────────────────
  // For each IMPLEMENTS edge pointing to an Interface, find all Classes that implement
  // it and create reverse edges. Also link interface method signatures to implementing
  // class methods.

  private resolveImplementations(graph: GraphData): ResolveResult {
    const result: ResolveResult = { updatedEdges: [], newEdges: [], updatedNodes: [] }
    const ts = this.getTs()
    if (!ts || !this.checker) return result

    const nodeMap = new Map<string, AuraNode>()
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node)
    }

    // Build a set of existing IMPLEMENTS edges to avoid duplicates
    const existingImplEdges = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.type === AuraEdgeType.IMPLEMENTS) {
        existingImplEdges.add(`${edge.source}|${edge.type}|${edge.target}`)
      }
    }

    // Find interface nodes and their implementations
    for (const node of graph.nodes) {
      if (node.kind !== AuraNodeKind.Interface) continue

      const tsFile = this.findTsFile(node.filePath)
      if (!tsFile) continue

      // Find the interface declaration in the TypeScript program
      const ifaceDecl = this.findDeclarationInFile(tsFile, node.name, ts.isInterfaceDeclaration)
      if (!ifaceDecl) continue

      const ifaceSymbol = this.checker.getSymbolAtLocation(ifaceDecl.name)
      if (!ifaceSymbol) continue

      // Find all classes that implement this interface
      const implementations = this.findImplementations(ifaceSymbol, nodeMap)

      for (const impl of implementations) {
        const edgeKey = `${impl.classId}|IMPLEMENTS|${node.id}`
        if (!existingImplEdges.has(edgeKey)) {
          result.newEdges.push({
            source: impl.classId,
            target: node.id,
            type: AuraEdgeType.IMPLEMENTS,
            confidence: 0.9,
            metadata: { typeResolution: 'ts-compiler' },
          })
          existingImplEdges.add(edgeKey)
        }

        // Link interface methods to implementing class methods
        this.linkInterfaceMethods(ifaceDecl, impl.classNode, impl.classId, node, nodeMap, result)
      }
    }

    return result
  }

  private findImplementations(
    ifaceSymbol: any,
    nodeMap: Map<string, AuraNode>,
  ): Array<{ classId: string; classNode: AuraNode }> {
    const ts = this.getTs()
    if (!ts) return []

    const results: Array<{ classId: string; classNode: AuraNode }> = []

    // Iterate all source files looking for classes that implement the interface
    for (const sourceFile of (this.program as any).getSourceFiles() as any[]) {
      if (sourceFile.isDeclarationFile) continue

      ts.forEachChild(sourceFile, (node: any) => {
        if (!ts.isClassDeclaration(node)) return
        if (!node.heritageClauses) return

        for (const clause of node.heritageClauses) {
          if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue
          for (const type of clause.types) {
            const typeSymbol = this.checker.getSymbolAtLocation(type.expression)
            if (typeSymbol === ifaceSymbol || typeSymbol === ifaceSymbol.declaredSymbol) {
              const className = node.name ? node.name.getText(sourceFile) : undefined
              if (!className) continue
              const filePath = path.relative(process.cwd(), sourceFile.fileName).replace(/\\/g, '/')
              const classId = `${filePath}:${className}`
              const classNode = nodeMap.get(classId)
              if (classNode) {
                results.push({ classId, classNode })
              }
            }
          }
        }
      })
    }

    return results
  }

  private linkInterfaceMethods(
    ifaceDecl: any,
    classNode: AuraNode,
    classId: string,
    ifaceNode: AuraNode,
    nodeMap: Map<string, AuraNode>,
    result: ResolveResult,
  ): void {
    // Find methods in the interface
    const ts = this.getTs()
    if (!ts) return

    const ifaceMembers = ifaceDecl.members as any[]
    for (const member of ifaceMembers) {
      if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue
      const memberName = member.name.getText()
      const ifaceMethodId = `${ifaceNode.id}:${memberName}`

      // Find the implementing method in the class
      const classMethodId = `${classId}:${memberName}`
      const classMethodNode = nodeMap.get(classMethodId)
      const ifaceMethodNode = nodeMap.get(ifaceMethodId)

      if (classMethodNode && ifaceMethodNode) {
        result.newEdges.push({
          source: ifaceMethodId,
          target: classMethodId,
          type: AuraEdgeType.CALLS,
          confidence: 0.85,
          metadata: {
            typeResolution: 'ts-compiler',
            callName: memberName,
            callTargetKind: 'direct',
          },
        })
      }
    }
  }

  // ── Re-export Resolution ────────────────────────────────────────────────────────
  // For IMPORTS edges targeting barrel files (index.ts/index.tsx), trace through
  // the re-exports to find the actual source module and create TYPE_ALIAS edges.

  private resolveReExports(graph: GraphData): ResolveResult {
    const result: ResolveResult = { updatedEdges: [], newEdges: [], updatedNodes: [] }
    const ts = this.getTs()
    if (!ts || !this.checker) return result

    const nodeMap = new Map<string, AuraNode>()
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node)
    }

    // Find IMPORTS edges targeting barrel files
    for (const edge of graph.edges) {
      if (edge.type !== AuraEdgeType.IMPORTS) continue

      // Check if the target is a barrel file (index.ts or index.tsx)
      const targetPath = edge.target
      const isBarrel = targetPath.endsWith('/index.ts') ||
                        targetPath.endsWith('/index.tsx') ||
                        targetPath.endsWith('/index.js') ||
                        targetPath.endsWith('/index.jsx') ||
                        // Also check if targetPath IS an index file at project root
                        targetPath === 'index.ts' ||
                        targetPath === 'index.tsx'

      if (!isBarrel) continue

      const tsFile = this.findTsFile(targetPath)
      if (!tsFile) continue

      // Parse re-exports in the barrel file
      this.resolveBarrelReExports(tsFile, edge, nodeMap, result)
    }

    return result
  }

  private resolveBarrelReExports(
    tsFile: any,
    importEdge: AuraEdge,
    nodeMap: Map<string, AuraNode>,
    result: ResolveResult,
  ): void {
    const ts = this.getTs()
    if (!ts) return

    ts.forEachChild(tsFile, (node: any) => {
      // Handle `export * from './module'`
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const moduleSpecifier = node.moduleSpecifier.getText(tsFile).replace(/['"]/g, '')
        const sourceDir = path.dirname(path.relative(process.cwd(), tsFile.fileName).replace(/\\/g, '/'))
        const resolvedPath = this.resolveModulePath(sourceDir, moduleSpecifier, nodeMap)

        if (resolvedPath && nodeMap.has(resolvedPath)) {
          // Create TYPE_ALIAS edge from barrel to source
          result.newEdges.push({
            source: importEdge.target,
            target: resolvedPath,
            type: AuraEdgeType.TYPE_ALIAS,
            confidence: 0.9,
            metadata: {
              typeResolution: 'ts-compiler',
              reexportType: 'exportAll',
            },
          })

          // If the importing file imported specific symbols, create symbol-level edges
          const importedSymbols = importEdge.metadata?.importedSymbols as Array<{ localName: string; exportedName: string }> | undefined
          if (importedSymbols) {
            for (const sym of importedSymbols) {
              // Look for the symbol in the resolved source file
              const symbolId = `${resolvedPath}:${sym.exportedName}`
              if (nodeMap.has(symbolId)) {
                result.newEdges.push({
                  source: `${importEdge.source}:${sym.localName}`,
                  target: symbolId,
                  type: AuraEdgeType.IMPORTS,
                  confidence: 0.85,
                  metadata: {
                    typeResolution: 'ts-compiler',
                    resolvedFrom: 'barrel_reexport',
                    importedName: sym.localName,
                  },
                })
              }
            }
          }
        }
      }

      // Handle `export { X } from './module'`
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && node.moduleSpecifier) {
        const moduleSpecifier = node.moduleSpecifier.getText(tsFile).replace(/['"]/g, '')
        const sourceDir = path.dirname(path.relative(process.cwd(), tsFile.fileName).replace(/\\/g, '/'))
        const resolvedPath = this.resolveModulePath(sourceDir, moduleSpecifier, nodeMap)

        if (resolvedPath && nodeMap.has(resolvedPath)) {
          result.newEdges.push({
            source: importEdge.target,
            target: resolvedPath,
            type: AuraEdgeType.TYPE_ALIAS,
            confidence: 0.9,
            metadata: {
              typeResolution: 'ts-compiler',
              reexportType: 'namedExport',
            },
          })

          // Create symbol-level edges for named re-exports
          for (const element of node.exportClause.elements) {
            const exportedName = element.name.getText(tsFile)
            const localName = element.propertyName ? element.propertyName.getText(tsFile) : exportedName
            const symbolId = `${resolvedPath}:${localName}`
            if (nodeMap.has(symbolId)) {
              result.newEdges.push({
                source: `${importEdge.target}:${exportedName}`,
                target: symbolId,
                type: AuraEdgeType.TYPE_ALIAS,
                confidence: 0.85,
                metadata: {
                  typeResolution: 'ts-compiler',
                  reexportType: 'namedSymbol',
                  exportedName,
                  localName,
                },
              })
            }
          }
        }
      }
    })
  }

  // ── Generic Subclass Resolution ─────────────────────────────────────────────────
  // For classes that extend generic base classes (e.g., `class X extends Base<T>`),
  // create TYPEOF edges from the subclass to the base class.

  private resolveGenerics(graph: GraphData): ResolveResult {
    const result: ResolveResult = { updatedEdges: [], newEdges: [], updatedNodes: [] }
    const ts = this.getTs()
    if (!ts) return result

    const nodeMap = new Map<string, AuraNode>()
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node)
    }

    // Find EXTENDS edges and check for generic arguments
    for (const edge of graph.edges) {
      if (edge.type !== AuraEdgeType.EXTENDS) continue

      // Look for the source class in TypeScript
      const colonIdx = edge.source.indexOf(':')
      const sourceFile = colonIdx >= 0 ? edge.source.substring(0, colonIdx) : edge.source

      const tsFile = this.findTsFile(sourceFile)
      if (!tsFile) continue

      // Find the class declaration
      const classDecl = this.findDeclarationInFile(tsFile, edge.source, ts.isClassDeclaration)
      if (!classDecl || !classDecl.heritageClauses) continue

      for (const clause of classDecl.heritageClauses) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
        for (const type of clause.types) {
          if (type.typeArguments && type.typeArguments.length > 0) {
            // This is a generic extension — create TYPEOF edge
            const baseName = type.expression.getText(tsFile)
            const genericArgs = type.typeArguments.map((t: any) => t.getText(tsFile))

            result.newEdges.push({
              source: edge.source,
              target: edge.target,
              type: AuraEdgeType.TYPEOF,
              confidence: 0.7,
              metadata: {
                typeResolution: 'ts-compiler',
                genericArgs,
                baseName,
              },
            })
          }
        }
      }
    }

    return result
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────

  private getTs(): any {
    try {
      return require('typescript')
    } catch {
      return null
    }
  }

  private findTsFile(filePath: string): any {
    if (!this.program) return null

    const absolutePath = path.resolve(filePath).replace(/\\/g, '/')
    const sourceFiles = (this.program as any).getSourceFiles() as any[]

    // Try exact match first
    let found = sourceFiles.find(sf => sf.fileName.replace(/\\/g, '/') === absolutePath)
    if (found) return found

    // Try with common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx']
    for (const ext of extensions) {
      found = sourceFiles.find(sf => sf.fileName.replace(/\\/g, '/') === absolutePath + ext)
      if (found) return found
    }

    // Try partial match
    found = sourceFiles.find(sf => sf.fileName.replace(/\\/g, '/').endsWith('/' + filePath))
    return found ?? null
  }

  private findDeclarationInFile(tsFile: any, nameOrId: string, guard: (node: any) => boolean): any {
    const ts = this.getTs()
    if (!ts) return null

    // Extract just the symbol name if it's a node ID
    const name = nameOrId.includes(':') ? nameOrId.substring(nameOrId.lastIndexOf(':') + 1) : nameOrId

    let found: any = null
    const visit = (node: any) => {
      if (found) return
      if (guard(node) && node.name && ts.isIdentifier(node.name)) {
        if (node.name.getText(tsFile) === name) {
          found = node
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(tsFile, visit)
    return found
  }

  private getTypeDeclarationId(type: any, nodeMap: Map<string, AuraNode>): string | null {
    if (!this.checker) return null

    const symbol = type.symbol ?? type.aliasSymbol
    if (!symbol) return null

    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!decl) return null

    const declFile = decl.getSourceFile().fileName
    const declPath = path.relative(process.cwd(), declFile).replace(/\\/g, '/')
    const declName = symbol.name

    // Check if a node matches
    const candidateId = `${declPath}:${declName}`
    if (nodeMap.has(candidateId)) return candidateId

    // Try just the file path for file-level types
    if (nodeMap.has(declPath)) return declPath

    return null
  }

  private resolveModulePath(sourceDir: string, moduleSpecifier: string, nodeMap: Map<string, AuraNode>): string | null {
    // Resolve relative module specifier to a file path
    if (!moduleSpecifier.startsWith('.')) return null

    const resolved = path.normalize(path.join(sourceDir, moduleSpecifier)).replace(/\\/g, '/')

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
    for (const ext of extensions) {
      const candidate = resolved + ext
      if (nodeMap.has(candidate)) return candidate
    }

    // Try exact path
    if (nodeMap.has(resolved)) return resolved

    return null
  }
}