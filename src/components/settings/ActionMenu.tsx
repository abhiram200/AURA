import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface ActionMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

interface ActionMenuProps {
  items: ActionMenuItem[]
}

export function ActionMenu({ items }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [flipUp, setFlipUp] = useState(false)

  const updatePos = useCallback(() => {
    if (!triggerRef.current || !dropdownRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const dropHeight = dropdownRef.current.offsetHeight
    const spaceBelow = window.innerHeight - triggerRect.bottom - 4
    const shouldFlip = spaceBelow < dropHeight && triggerRect.top > dropHeight + 4

    setFlipUp(shouldFlip)
    setPos({
      top: shouldFlip ? triggerRect.top - dropHeight - 4 : triggerRect.bottom + 4,
      left: triggerRect.right,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      updatePos()
    })
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, updatePos])

  return (
    <>
      <button
        ref={triggerRef}
        className="action-menu__trigger"
        onClick={() => setOpen(!open)}
      >
        ⋮
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          className={`action-menu__dropdown action-menu__dropdown--portal${flipUp ? ' action-menu__dropdown--flip-up' : ''}`}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              className={`action-menu__item${item.danger ? ' action-menu__item--danger' : ''}`}
              onClick={() => {
                item.onClick()
                setOpen(false)
              }}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}