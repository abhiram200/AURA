import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { foldGutter, indentUnit, bracketMatching, indentOnInput } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { php } from '@codemirror/lang-php'
import { less } from '@codemirror/lang-less'
import { sass } from '@codemirror/lang-sass'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import * as prettier from 'prettier'
import prettierPluginEstree from 'prettier/plugins/estree'
import prettierPluginTypescript from 'prettier/plugins/typescript'
import prettierPluginBabel from 'prettier/plugins/babel'
import prettierPluginHtml from 'prettier/plugins/html'
import prettierPluginCss from 'prettier/plugins/postcss'
import prettierPluginMarkdown from 'prettier/plugins/markdown'
import prettierPluginYaml from 'prettier/plugins/yaml'
import { getThemeExtension, getThemeInfo } from '../../utils/editorThemes'
import type { OpenFile } from '../../hooks/useWorkspace'

function getPrettierParser(path: string): string | null {
  if (path.endsWith('.tsx')) return 'babel-ts'
  if (path.endsWith('.ts')) return 'typescript'
  if (path.endsWith('.jsx')) return 'babel'
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'babel'
  if (path.endsWith('.css') || path.endsWith('.scss') || path.endsWith('.less')) return 'css'
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'html'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown'
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml'
  return null
}

function getPrettierPlugins(parser: string) {
  switch (parser) {
    case 'babel-ts': return [prettierPluginBabel, prettierPluginEstree, prettierPluginTypescript]
    case 'typescript': return [prettierPluginTypescript, prettierPluginEstree]
    case 'babel': return [prettierPluginBabel, prettierPluginEstree]
    case 'css': return [prettierPluginCss]
    case 'html': return [prettierPluginHtml]
    case 'json': return [prettierPluginBabel, prettierPluginEstree]
    case 'markdown': return [prettierPluginMarkdown]
    case 'yaml': return [prettierPluginYaml]
    default: return []
  }
}

const themeCompartment = new Compartment()
const lightOverrideCompartment = new Compartment()

const LIGHT_THEME_OVERRIDE = EditorView.theme({
  '&': { backgroundColor: '#ffffff', color: '#1e293b' },
  '.cm-gutters': { backgroundColor: '#f8f8fa', color: '#94a3b8', borderRight: '1px solid rgba(0,0,0,0.06)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(0,0,0,0.03)', color: '#64748b' },
  '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.02)' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(8,145,178,0.15) !important' },
  '.cm-cursor': { borderLeftColor: '#0891b2' },
  '.cm-foldGutter': { color: '#94a3b8' },
  '.cm-scroller': { backgroundColor: '#ffffff' },
  '.cm-content': { caretColor: '#1e293b' },
  '.cm-line': { color: '#1e293b' },
  '.cm-comment': { color: '#a0a1a7', fontStyle: 'italic' },
  '.cm-keyword': { color: '#a626a4' },
  '.cm-string': { color: '#50a14f' },
  '.cm-number': { color: '#986801' },
  '.cm-bool': { color: '#986801' },
  '.cm-variableName': { color: '#1e293b' },
  '.cm-function': { color: '#4078f2' },
  '.cm-operator': { color: '#383a42' },
  '.cm-typeName': { color: '#c18401' },
  '.cm-propertyName': { color: '#4078f2' },
  '.cm-property': { color: '#4078f2' },
  '.cm-tag': { color: '#e45649' },
  '.cm-attribute': { color: '#986801' },
  '.cm-definition': { color: '#a626a4' },
  '.cm-heading': { color: '#4078f2', fontWeight: 'bold' },
  '.cm-strong': { color: '#1e293b', fontWeight: 'bold' },
  '.cm-emphasis': { color: '#1e293b', fontStyle: 'italic' },
  '.cm-link': { color: '#4078f2' },
  '.cm-url': { color: '#0284c7' },
  '.cm-processingInstruction': { color: '#a626a4' },
}, { dark: false })

interface CodeEditorProps {
  file: OpenFile
  onChange: (content: string) => void
  onSave: () => void
  editorTheme?: string
  isLightMode?: boolean
}

function getLanguageExtension(path: string) {
  if (path.endsWith('.tsx') || path.endsWith('.jsx')) return javascript({ jsx: true })
  if (path.endsWith('.ts')) return javascript({ typescript: true })
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return javascript()
  if (path.endsWith('.css')) return css()
  if (path.endsWith('.scss')) return sass()
  if (path.endsWith('.less')) return less()
  if (path.endsWith('.html') || path.endsWith('.htm')) return html()
  if (path.endsWith('.json')) return json()
  if (path.endsWith('.md') || path.endsWith('.markdown')) return markdown()
  if (path.endsWith('.py') || path.endsWith('.pyw')) return python()
  if (path.endsWith('.c') || path.endsWith('.h') || path.endsWith('.cpp') || path.endsWith('.cc') || path.endsWith('.cxx') || path.endsWith('.hpp') || path.endsWith('.hh')) return cpp()
  if (path.endsWith('.java')) return java()
  if (path.endsWith('.rs')) return rust()
  if (path.endsWith('.go')) return go()
  if (path.endsWith('.sql')) return sql()
  if (path.endsWith('.xml') || path.endsWith('.svg') || path.endsWith('.xsl') || path.endsWith('.xslt') || path.endsWith('.xsd')) return xml()
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return yaml()
  if (path.endsWith('.php') || path.endsWith('.phtml')) return php()
  if (path.endsWith('.sh') || path.endsWith('.bash') || path.endsWith('.zsh')) return StreamLanguage.define(shell)
  return []
}

export function CodeEditor({ file, onChange, onSave, editorTheme = 'catppuccin-mocha', isLightMode = false }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isUpdating = useRef(false)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)

  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!containerRef.current) return

    const langExt = getLanguageExtension(file.path)
    const parser = getPrettierParser(file.path)

    const formatDoc = async (view: EditorView) => {
      if (!parser) return false
      try {
        const plugins = getPrettierPlugins(parser)
        const formatted = await prettier.format(view.state.doc.toString(), {
          parser,
          plugins,
          filepath: file.path,
        })
        if (formatted !== view.state.doc.toString()) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: formatted },
          })
        }
        return true
      } catch {
        return false
      }
    }

    const state = EditorState.create({
      doc: file.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        foldGutter(),
        indentUnit.of('  '),
        history(),
        highlightSelectionMatches(),
        autocompletion(),
        themeCompartment.of(getThemeExtension(editorTheme)),
        lightOverrideCompartment.of((isLightMode && !getThemeInfo(editorTheme).isLight) ? LIGHT_THEME_OVERRIDE : []),
        langExt,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => { onSaveRef.current(); return true },
          },
          {
            key: 'Shift-Alt-f',
            run: (v) => { formatDoc(v); return true },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isUpdating.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          '&': { height: '100%', width: '100%', fontSize: '15px' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [file.path])

  // Switch theme dynamically without destroying the editor
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(getThemeExtension(editorTheme)),
        lightOverrideCompartment.reconfigure((isLightMode && !getThemeInfo(editorTheme).isLight) ? LIGHT_THEME_OVERRIDE : []),
      ],
    })
  }, [editorTheme, isLightMode])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentContent = view.state.doc.toString()
    if (currentContent !== file.content) {
      isUpdating.current = true
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: file.content },
      })
      isUpdating.current = false
    }
  }, [file.content])

  if (file.binary) {
    return (
      <div className="code-editor code-editor--binary">
        <div className="code-editor__binary-msg">Binary file — cannot display</div>
      </div>
    )
  }

  return (
    <div className="code-editor" ref={containerRef} />
  )
}