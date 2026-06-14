import { useEffect, useRef, useCallback } from 'react'
import { useTodoStore } from '../store/todoStore'

/**
 * Hook that syncs the todo store with the server.
 * Loads data on mount and auto-saves with a debounce.
 */
export function useTaskSync(projectId: string) {
  const loadFromServer = useTodoStore((s) => s.loadFromServer)
  const saveToServer = useTodoStore((s) => s.saveToServer)
  const loading = useTodoStore((s) => s.loading)
  const error = useTodoStore((s) => s.error)

  // Track the last saved state hash to avoid unnecessary saves
  const lastSavedHash = useRef('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load on mount or when projectId changes
  useEffect(() => {
    if (projectId) {
      loadFromServer(projectId)
    }
  }, [projectId, loadFromServer])

  // Debounced save — subscribe to store changes and save after 500ms of inactivity
  useEffect(() => {
    if (!projectId || loading) return

    // Subscribe to store changes
    const unsubscribe = useTodoStore.subscribe((state) => {
      // Only save if there are todos or groups (skip initial empty state)
      const dataToSave = { groups: state.groups, items: state.todos }
      const hash = JSON.stringify(dataToSave)

      if (hash === lastSavedHash.current) return

      // Clear any pending save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      // Debounce: save after 500ms of no changes
      saveTimerRef.current = setTimeout(() => {
        lastSavedHash.current = hash
        saveToServer(projectId)
      }, 500)
    })

    return () => {
      unsubscribe()
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [projectId, loading, saveToServer])

  // Initial load hash after loading
  const groups = useTodoStore((s) => s.groups)
  const todos = useTodoStore((s) => s.todos)

  useEffect(() => {
    if (!loading && groups.length >= 0 && todos.length >= 0) {
      lastSavedHash.current = JSON.stringify({ groups, items: todos })
    }
  }, [loading]) // Only set hash after initial load completes

  return { loading, error }
}