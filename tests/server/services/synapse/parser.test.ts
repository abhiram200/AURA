import { describe, it, expect, beforeAll } from 'vitest'
import { SynapseParser } from '@server/services/synapse/parser.ts'
import { SynapseNodeKind, SynapseEdgeType } from '@server/services/synapse/types.ts'

const parser = new SynapseParser()

beforeAll(async () => {
  await parser.init()
})

describe('SynapseParser', () => {
  it('initializes and isReady returns true', () => {
    expect(parser.isReady()).toBe(true)
  })

  it('parses a simple JS file with function declaration', async () => {
    const source = `
function hello() {
  return 42;
}
`
    const result = await parser.parseFile('src/hello.js', source)

    expect(result.filePath).toBe('src/hello.js')
    const helloFunc = result.symbols.find(s => s.name === 'hello')
    expect(helloFunc).toBeDefined()
    expect(helloFunc!.kind).toBe(SynapseNodeKind.Function)
    expect(helloFunc!.exported).toBe(false)
  })

  it('parses a simple TS file with interface', async () => {
    const source = `
interface Animal {
  name: string;
  speak(): void;
}
`
    const result = await parser.parseFile('src/animal.ts', source)

    const iface = result.symbols.find(s => s.name === 'Animal')
    expect(iface).toBeDefined()
    expect(iface!.kind).toBe(SynapseNodeKind.Interface)
  })

  it('extracts class declarations', async () => {
    const source = `
class Dog {
  bark() {
    return "woof";
  }
}
`
    const result = await parser.parseFile('src/dog.ts', source)

    const cls = result.symbols.find(s => s.name === 'Dog')
    expect(cls).toBeDefined()
    expect(cls!.kind).toBe(SynapseNodeKind.Class)
  })

  it('extracts methods from classes', async () => {
    const source = `
class Calculator {
  add(a, b) {
    return a + b;
  }
  subtract(a, b) {
    return a - b;
  }
}
`
    const result = await parser.parseFile('src/calc.js', source)

    const addMethod = result.symbols.find(s => s.name === 'add')
    expect(addMethod).toBeDefined()
    expect(addMethod!.kind).toBe(SynapseNodeKind.Method)

    const subMethod = result.symbols.find(s => s.name === 'subtract')
    expect(subMethod).toBeDefined()
    expect(subMethod!.kind).toBe(SynapseNodeKind.Method)
  })

  it('extracts import edges', async () => {
    const source = `
import { useState } from 'react';
import express from 'express';
`
    const result = await parser.parseFile('src/app.ts', source)

    expect(result.imports.length).toBeGreaterThanOrEqual(1)

    const reactImport = result.imports.find(e => e.target === 'react')
    expect(reactImport).toBeDefined()
    expect(reactImport!.type).toBe(SynapseEdgeType.IMPORTS)
    expect(reactImport!.metadata?.rawImportPath).toBe('react')

    const expressImport = result.imports.find(e => e.target === 'express')
    expect(expressImport).toBeDefined()
  })

  it('extracts extends and implements heritage', async () => {
    const source = `
class Dog extends Animal implements IPet {
  bark() {
    return "woof";
  }
}
`
    const result = await parser.parseFile('src/dog.ts', source)

    const extendsEdge = result.heritage.find(e => e.type === SynapseEdgeType.EXTENDS)
    expect(extendsEdge).toBeDefined()
    expect(extendsEdge!.target).toBe('Animal')
    expect(extendsEdge!.source).toContain('Dog')

    const implementsEdge = result.heritage.find(e => e.type === SynapseEdgeType.IMPLEMENTS)
    expect(implementsEdge).toBeDefined()
    expect(implementsEdge!.target).toBe('IPet')
  })

  it('extracts call expressions', async () => {
    const source = `
function compute() {
  console.log("hello");
  fetchData();
}
`
    const result = await parser.parseFile('src/compute.js', source)

    expect(result.calls.length).toBeGreaterThanOrEqual(1)

    const logCall = result.calls.find(e => e.target === 'log')
    expect(logCall).toBeDefined()
    expect(logCall!.type).toBe(SynapseEdgeType.CALLS)

    const fetchCall = result.calls.find(e => e.target === 'fetchData')
    expect(fetchCall).toBeDefined()
  })

  it('creates CONTAINS edges from file to symbols', async () => {
    const source = `
function greet() {
  return "hello";
}

const x = 42;
`
    const result = await parser.parseFile('src/greet.js', source)

    expect(result.contains.length).toBeGreaterThanOrEqual(1)

    const greetContains = result.contains.find(
      e => e.target === 'src/greet.js:greet',
    )
    expect(greetContains).toBeDefined()
    expect(greetContains!.type).toBe(SynapseEdgeType.CONTAINS)
    expect(greetContains!.source).toBe('src/greet.js')
  })

  it('detects exported symbols', async () => {
    const source = `
export function hello() {
  return 42;
}

function privateHelper() {
  return 1;
}
`
    const result = await parser.parseFile('src/exported.ts', source)

    const helloFunc = result.symbols.find(s => s.name === 'hello')
    expect(helloFunc).toBeDefined()
    expect(helloFunc!.exported).toBe(true)

    const privateFunc = result.symbols.find(s => s.name === 'privateHelper')
    expect(privateFunc).toBeDefined()
    expect(privateFunc!.exported).toBe(false)
  })

  it('isParsable returns true for supported extensions', () => {
    expect(parser.isParsable('app.ts')).toBe(true)
    expect(parser.isParsable('component.tsx')).toBe(true)
    expect(parser.isParsable('index.js')).toBe(true)
    expect(parser.isParsable('module.mjs')).toBe(true)
    expect(parser.isParsable('common.cjs')).toBe(true)
    expect(parser.isParsable('view.jsx')).toBe(true)
    expect(parser.isParsable('style.css')).toBe(false)
    expect(parser.isParsable('readme.md')).toBe(false)
    expect(parser.isParsable('data.json')).toBe(false)
  })

  it('shouldIgnore returns true for known directories', () => {
    expect(parser.shouldIgnore('node_modules')).toBe(true)
    expect(parser.shouldIgnore('dist')).toBe(true)
    expect(parser.shouldIgnore('.git')).toBe(true)
    expect(parser.shouldIgnore('build')).toBe(true)
    expect(parser.shouldIgnore('coverage')).toBe(true)
    expect(parser.shouldIgnore('.next')).toBe(true)
    expect(parser.shouldIgnore('target')).toBe(true)
    expect(parser.shouldIgnore('vendor')).toBe(true)
    expect(parser.shouldIgnore('__pycache__')).toBe(true)
    expect(parser.shouldIgnore('.terraform')).toBe(true)
    expect(parser.shouldIgnore('.synapse')).toBe(true)
    expect(parser.shouldIgnore('out')).toBe(true)
    expect(parser.shouldIgnore('.cache')).toBe(true)
    expect(parser.shouldIgnore('.vscode')).toBe(true)
    expect(parser.shouldIgnore('.idea')).toBe(true)

    expect(parser.shouldIgnore('src')).toBe(false)
    expect(parser.shouldIgnore('components')).toBe(false)
    expect(parser.shouldIgnore('hooks')).toBe(false)
    expect(parser.shouldIgnore('pages')).toBe(false)
  })
})