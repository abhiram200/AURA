import { useState, useEffect, useRef, useCallback } from 'react'
import type { FileEntry } from '../../hooks/useWorkspace'

interface QuickOpenProps {
  projectId: string
  searchFiles: (query: string) => Promise<FileEntry[]>
  onOpenFile: (path: string) => void
  onClose: () => void
}

export function QuickOpen({ searchFiles, onOpenFile, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileEntry[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim()) {
        const files = await searchFiles(query)
        setResults(files)
        setSelectedIndex(0)
      } else {
        setResults([])
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [query, searchFiles])

  const handleSelect = useCallback((path: string) => {
    onOpenFile(path)
    onClose()
  }, [onOpenFile, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex].path)
    }
  }, [results, selectedIndex, handleSelect, onClose])

  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  return (
    <div className="quick-open__backdrop" onClick={onClose}>
      <div className="quick-open" onClick={(e) => e.stopPropagation()}>
        <div className="quick-open__input-wrap">
          <svg className="quick-open__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="quick-open__input"
            type="text"
            placeholder="Search files by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {results.length > 0 && (
          <div className="quick-open__results" ref={listRef}>
            {results.map((file, index) => (
              <div
                key={file.path}
                className={`quick-open__result${index === selectedIndex ? ' quick-open__result--selected' : ''}`}
                onClick={() => handleSelect(file.path)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={`quick-open__result-icon${file.type === 'directory' ? ' quick-open__result-icon--dir' : ''}`}>
                  {file.type === 'directory' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  )}
                </span>
                <span className="quick-open__result-name">{file.name}</span>
                <span className="quick-open__result-path">{file.path}</span>
              </div>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="quick-open__empty">No files found</div>
        )}
      </div>
    </div>
  )
}