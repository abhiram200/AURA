import { useState, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: string
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const triggerRef = useRef<HTMLDivElement>(null)

  const show = () => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const gap = 8
      let top = 0
      let left = 0

      if (position === 'top') {
        top = rect.top - gap
        left = rect.left + rect.width / 2
      } else if (position === 'bottom') {
        top = rect.bottom + gap
        left = rect.left + rect.width / 2
      } else if (position === 'left') {
        top = rect.top + rect.height / 2
        left = rect.left - gap
      } else {
        top = rect.top + rect.height / 2
        left = rect.right + gap
      }

      setCoords({ top, left })
      setVisible(true)
    }, 300)
  }

  const hide = () => {
    clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  const portalStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    maxWidth: '200px',
    width: 'max-content',
  }

  if (position === 'top') {
    portalStyle.bottom = `calc(100vh - ${coords.top}px)`
    portalStyle.left = coords.left
    portalStyle.transform = 'translateX(-50%)'
  } else if (position === 'bottom') {
    portalStyle.top = coords.top
    portalStyle.left = coords.left
    portalStyle.transform = 'translateX(-50%)'
  } else if (position === 'left') {
    portalStyle.top = coords.top
    portalStyle.right = `calc(100vw - ${coords.left}px)`
    portalStyle.transform = 'translateY(-50%)'
  } else {
    portalStyle.top = coords.top
    portalStyle.left = coords.left
    portalStyle.transform = 'translateY(-50%)'
  }

  return (
    <div className="tooltip-wrapper" ref={triggerRef} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && createPortal(
        <div className={`tooltip tooltip--${position}`} style={portalStyle}>
          {content}
        </div>,
        document.body
      )}
    </div>
  )
}