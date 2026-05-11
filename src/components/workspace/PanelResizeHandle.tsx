import { useCallback, useRef, useState } from 'react'

interface PanelResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  minSize?: number
  maxSize?: number
}

export function PanelResizeHandle({ direction, onResize }: PanelResizeHandleProps) {
  const dragRef = useRef<{ startMouse: number; started: boolean }>({ startMouse: 0, started: false })
  const [dragging, setDragging] = useState(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startMouse: direction === 'horizontal' ? e.clientX : e.clientY, started: true }
    setDragging(true)

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current.started) return
      const current = direction === 'horizontal' ? ev.clientX : ev.clientY
      const delta = current - dragRef.current.startMouse
      dragRef.current.startMouse = current
      onResize(delta)
    }

    const onMouseUp = () => {
      dragRef.current.started = false
      setDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [direction, onResize])

  return (
    <div
      className={`panel-resize-handle panel-resize-handle--${direction}${dragging ? ' panel-resize-handle--active' : ''}`}
      onMouseDown={onMouseDown}
    />
  )
}