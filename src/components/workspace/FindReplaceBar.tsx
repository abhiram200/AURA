import { useState, useEffect, useRef, useCallback } from 'react'
import { EditorView } from '@codemirror/view'
import { SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search'
import type { CodeEditorHandle } from './CodeEditor'

interface FindReplaceBarProps {
  editorHandle: React.RefObject<CodeEditorHandle | null>
  onClose: () => void
  initialSearchText?: string
  initialReplaceVisible?: boolean
}

function countMatches(query: SearchQuery, view: EditorView): { total: number; current: number } {
  if (!query.search || !query.valid) return { total: 0, current: 0 }
  try {
    const cursor = query.getCursor(view.state)
    const sel = view.state.selection.main
    let total = 0
    let current = 0
    let foundCurrent = false
    while (!cursor.next().done) {
      total++
      const { from, to } = cursor.value
      if (!foundCurrent) {
        if (from <= sel.head && to >= sel.head) {
          current = total
          foundCurrent = true
        } else if (from > sel.head) {
          current = total
          foundCurrent = true
        }
      }
      if (total > 99999) break
    }
    if (!foundCurrent && total > 0) current = 1
    return { total, current }
  } catch {
    return { total: 0, current: 0 }
  }
}

export function FindReplaceBar({ editorHandle, onClose, initialSearchText = '', initialReplaceVisible = false }: FindReplaceBarProps) {
  const [searchText, setSearchText] = useState(initialSearchText)
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [showReplace, setShowReplace] = useState(initialReplaceVisible)
  const [matchInfo, setMatchInfo] = useState({ total: 0, current: 0 })
  const [isRegexError, setIsRegexError] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const closingRef = useRef(false)

  // Auto-focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [])

  // Dispatch search query to CodeMirror whenever search parameters change
  useEffect(() => {
    const view = editorHandle.current?.getView()
    if (!view) return

    const query = new SearchQuery({
      search: searchText,
      caseSensitive,
      literal: !useRegex,
      wholeWord,
    })

    if (useRegex && searchText && !query.valid) {
      setIsRegexError(true)
      setMatchInfo({ total: 0, current: 0 })
      return
    }
    setIsRegexError(false)

    try {
      view.dispatch({ effects: setSearchQuery.of(query) })
      const { total, current } = countMatches(query, view)
      setMatchInfo({ total, current })
    } catch {
      setMatchInfo({ total: 0, current: 0 })
    }
  }, [searchText, caseSensitive, wholeWord, useRegex, editorHandle])

  // Re-dispatch query when the editor view changes (file switch)
  useEffect(() => {
    const interval = setInterval(() => {
      const view = editorHandle.current?.getView()
      if (!view) return
      try {
        const currentQuery = getSearchQuery(view.state)
        // If the search state was lost (file switch), re-dispatch
        if (currentQuery && !currentQuery.search && searchText) {
          const query = new SearchQuery({
            search: searchText,
            caseSensitive,
            literal: !useRegex,
            wholeWord,
          })
          if (query.valid) {
            view.dispatch({ effects: setSearchQuery.of(query) })
            const { total, current } = countMatches(query, view)
            setMatchInfo({ total, current })
          }
        }
      } catch { /* view may not be ready yet */ }
    }, 200)
    return () => clearInterval(interval)
  }, [searchText, caseSensitive, wholeWord, useRegex, editorHandle])

  const handleClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    const view = editorHandle.current?.getView()
    if (view) {
      try {
        view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
      } catch { /* ignore */ }
    }
    onClose()
  }, [editorHandle, onClose])

  const handleFindNext = useCallback(() => {
    const view = editorHandle.current?.getView()
    if (!view) return
    findNext(view)
    // Update current match index after navigation
    requestAnimationFrame(() => {
      const q = new SearchQuery({ search: searchText, caseSensitive, literal: !useRegex, wholeWord })
      if (q.valid) {
        const { total, current } = countMatches(q, view)
        setMatchInfo({ total, current })
      }
    })
  }, [editorHandle, searchText, caseSensitive, useRegex, wholeWord])

  const handleFindPrevious = useCallback(() => {
    const view = editorHandle.current?.getView()
    if (!view) return
    findPrevious(view)
    requestAnimationFrame(() => {
      const q = new SearchQuery({ search: searchText, caseSensitive, literal: !useRegex, wholeWord })
      if (q.valid) {
        const { total, current } = countMatches(q, view)
        setMatchInfo({ total, current })
      }
    })
  }, [editorHandle, searchText, caseSensitive, useRegex, wholeWord])

  const handleReplaceCurrent = useCallback(() => {
    const view = editorHandle.current?.getView()
    if (!view) return
    replaceNext(view)
    // Re-count after replacement
    requestAnimationFrame(() => {
      const q = new SearchQuery({ search: searchText, caseSensitive, literal: !useRegex, wholeWord })
      if (q.valid) {
        const { total, current } = countMatches(q, view)
        setMatchInfo({ total, current })
      }
    })
  }, [editorHandle, searchText, caseSensitive, useRegex, wholeWord])

  const handleReplaceAll = useCallback(() => {
    const view = editorHandle.current?.getView()
    if (!view) return
    replaceAll(view)
    setMatchInfo({ total: 0, current: 0 })
  }, [editorHandle])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) {
        handleFindPrevious()
      } else {
        handleFindNext()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
    }
  }, [handleFindNext, handleFindPrevious, handleClose])

  const handleReplaceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      handleReplaceCurrent()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
    }
  }, [handleReplaceCurrent, handleClose])

  const matchCountText = matchInfo.total > 0
    ? `${matchInfo.current} of ${matchInfo.total}`
    : searchText ? 'No results' : ''

  return (
    <div className="find-replace">
      <div className="find-replace__row">
        <button
          className={`find-replace__toggle-replace${showReplace ? ' find-replace__toggle-replace--open' : ''}`}
          onClick={() => setShowReplace(!showReplace)}
          title={showReplace ? 'Hide replace' : 'Show replace'}
          aria-label={showReplace ? 'Hide replace' : 'Show replace'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        <div className="find-replace__input-wrap">
          <input
            ref={searchInputRef}
            className={`find-replace__input${isRegexError ? ' find-replace__input--error' : ''}`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find"
            spellCheck={false}
          />
          {matchCountText && (
            <span className={`find-replace__match-count${matchInfo.total === 0 ? ' find-replace__match-count--no-results' : ''}`}>
              {matchCountText}
            </span>
          )}
        </div>
        <div className="find-replace__toggles">
          <button
            className={`find-replace__toggle-btn${caseSensitive ? ' find-replace__toggle-btn--active' : ''}`}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title="Match Case"
          >
            Aa
          </button>
          <button
            className={`find-replace__toggle-btn${wholeWord ? ' find-replace__toggle-btn--active' : ''}`}
            onClick={() => setWholeWord(!wholeWord)}
            title="Match Whole Word"
          >
            Ab|
          </button>
          <button
            className={`find-replace__toggle-btn${useRegex ? ' find-replace__toggle-btn--active' : ''}`}
            onClick={() => setUseRegex(!useRegex)}
            title="Use Regular Expression"
          >
            .*
          </button>
        </div>
        <div className="find-replace__nav">
          <button
            className="find-replace__nav-btn"
            onClick={handleFindPrevious}
            title="Previous Match (Shift+Enter)"
            aria-label="Previous match"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 10l4-4 4 4" />
            </svg>
          </button>
          <button
            className="find-replace__nav-btn"
            onClick={handleFindNext}
            title="Next Match (Enter)"
            aria-label="Next match"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>
        <button
          className="find-replace__close"
          onClick={handleClose}
          title="Close (Escape)"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
          </svg>
        </button>
      </div>
      {showReplace && (
        <div className="find-replace__row find-replace__row--replace">
          <div className="find-replace__replace-spacer" />
          <div className="find-replace__input-wrap">
            <input
              className="find-replace__input"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={handleReplaceKeyDown}
              placeholder="Replace"
              spellCheck={false}
            />
          </div>
          <div className="find-replace__replace-actions">
            <button
              className="find-replace__replace-btn"
              onClick={handleReplaceCurrent}
              title="Replace Current"
              disabled={matchInfo.total === 0}
            >
              Replace
            </button>
            <button
              className="find-replace__replace-btn find-replace__replace-btn--all"
              onClick={handleReplaceAll}
              title="Replace All"
              disabled={matchInfo.total === 0}
            >
              All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}