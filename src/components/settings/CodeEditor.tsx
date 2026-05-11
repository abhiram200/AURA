import { useRef, useCallback, useEffect, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: 'javascript' | 'json'
  placeholder?: string
  disabled?: boolean
  minLines?: number
}

export function CodeEditor({ value, onChange, language, placeholder, disabled, minLines = 8 }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const lineNumsRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)

  const displayValue = value || ''
  const lines = displayValue.split('\n')
  const lineCount = Math.max(minLines, lines.length + 1)

  const highlighted = displayValue
    ? hljs.highlight(displayValue, { language }).value
    : placeholder
      ? `<span class="code-editor__placeholder">${hljs.highlight(placeholder, { language }).value}</span>`
      : ''

  useEffect(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
    if (textareaRef.current && lineNumsRef.current) {
      lineNumsRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [value])

  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
    if (textareaRef.current && lineNumsRef.current) {
      lineNumsRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget
    const { selectionStart, selectionEnd, value: val } = textarea

    if (e.key === 'Tab') {
      e.preventDefault()
      const indent = '  '
      if (e.shiftKey) {
        // Shift+Tab: outdent
        const lineStart = val.lastIndexOf('\n', selectionStart - 1) + 1
        const lineText = val.substring(lineStart, selectionEnd)
        if (lineText.startsWith(indent)) {
          const before = val.substring(0, lineStart)
          const after = val.substring(selectionEnd)
          const newText = before + lineText.replace(new RegExp(`^(${indent})`, 'gm'), '') + after
          onChange(newText)
          const offset = selectionStart - (selectionStart > lineStart && val.substring(lineStart, selectionStart).startsWith(indent) ? 2 : 0)
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, offset)
          })
        }
      } else {
        const before = val.substring(0, selectionStart)
        const after = val.substring(selectionEnd)
        onChange(before + indent + after)
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + indent.length
        })
      }
    } else if (e.key === 'Enter') {
      // Auto-indent: match previous line's indentation
      e.preventDefault()
      const lineStart = val.lastIndexOf('\n', selectionStart - 1) + 1
      const currentLine = val.substring(lineStart, selectionStart)
      const match = currentLine.match(/^(\s*)/)
      const indent = match ? match[1] : ''
      // Extra indent after { or :
      const charBefore = val[selectionStart - 1]
      const extraIndent = (charBefore === '{' || charBefore === ':') ? '  ' : ''
      // Check if we're closing a block
      const charAfter = val[selectionStart]
      const outdent = (charAfter === '}' || charAfter === ']') ? '' : ''
      const newIndent = indent + extraIndent
      const before = val.substring(0, selectionStart)
      const after = val.substring(selectionEnd)
      const inserted = '\n' + newIndent
      onChange(before + inserted + (charAfter === '}' || charAfter === ']' ? '\n' + indent : '') + after)
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = before.length + inserted.length
      })
    }
  }, [onChange])

  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1)

  return (
    <div className={`code-editor${isFocused ? ' code-editor--focused' : ''}${disabled ? ' code-editor--disabled' : ''}`}>
      <div className="code-editor__line-nums" ref={lineNumsRef}>
        {lineNumbers.map((n) => (
          <div key={n} className="code-editor__line-num">{n}</div>
        ))}
      </div>
      <div className="code-editor__content">
        <div className="code-editor__highlight">
          <pre ref={highlightRef} className="code-editor__pre"><code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} /></pre>
        </div>
        <textarea
          ref={textareaRef}
          className="code-editor__textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          spellCheck={false}
          disabled={disabled}
          rows={lineCount}
        />
      </div>
      <div className="code-editor__lang-badge">{language === 'javascript' ? 'JS' : 'JSON'}</div>
    </div>
  )
}