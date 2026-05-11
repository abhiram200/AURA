import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { getTransition } from '../../hooks/useAnimationConfig'
import { GlowButton } from '../shared/GlowButton'

interface ProjectModeButtonProps {
  projectModeAccepted?: boolean
  projectId?: string | null
  conversationId?: string | null
}

export function ProjectModeButton({ projectModeAccepted, projectId, conversationId }: ProjectModeButtonProps) {
  const navigate = useNavigate()
  const { animationIntensity } = useAnimationConfig()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const isDisabled = projectModeAccepted === false

  const handleClick = useCallback(() => {
    if (projectModeAccepted === undefined) {
      navigate('/project-mode', { state: { conversationId } })
    } else if (projectModeAccepted === true) {
      if (projectId) {
        navigate(`/project-mode/${projectId}`, { state: { conversationId } })
      } else {
        navigate('/project-mode', { state: { conversationId } })
      }
    } else {
      setPopoverOpen((prev) => !prev)
    }
  }, [projectModeAccepted, projectId, conversationId, navigate])

  const handleInitiateNewProject = useCallback(() => {
    navigate('/project-mode', { state: { tab: 'new-project', conversationId } })
    setPopoverOpen(false)
  }, [navigate, conversationId])

  const handleCancel = useCallback(() => {
    setPopoverOpen(false)
  }, [])

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return

    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

  // Close popover on Escape key
  useEffect(() => {
    if (!popoverOpen) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopoverOpen(false)
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [popoverOpen])

  return (
    <div className="project-mode-button-wrapper" ref={wrapperRef}>
      <GlowButton
        variant="ghost"
        onClick={handleClick}
        className={isDisabled ? 'project-mode-button--disabled' : ''}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </GlowButton>

      <AnimatePresence>
        {popoverOpen && (
          <motion.div
            className="project-mode-popover"
            initial={animationIntensity !== 'subtle' ? { opacity: 0, y: -8, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={animationIntensity !== 'subtle' ? { opacity: 0, y: -4, scale: 0.97 } : { opacity: 0 }}
            transition={getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity)}
          >
            <div className="project-mode-popover__icon">📂</div>
            <div className="project-mode-popover__title">No Project Mode Conversation Found</div>
            <div className="project-mode-popover__message">
              This chat doesn't have an active project mode session. Would you like to start a new project?
            </div>
            <div className="project-mode-popover__actions">
              <button className="project-mode-popover__primary" onClick={handleInitiateNewProject}>
                Initiate New Project
              </button>
              <button className="project-mode-popover__secondary" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}