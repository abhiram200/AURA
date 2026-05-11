import { useState, useEffect, useCallback } from 'react'

export interface MemoryEntry {
  id: string
  fact: string
  source: string
  active: boolean
  createdAt: string
}

export function useMemory() {
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch('/api/memory')
      if (res.ok) {
        const data = await res.json()
        setMemories(data.memories)
      }
    } catch {
      // Use empty list
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  const addMemory = useCallback(async (fact: string) => {
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact }),
    })
    if (res.ok) {
      const entry = await res.json()
      setMemories((prev) => [...prev, entry])
      return entry
    }
    return null
  }, [])

  const updateMemory = useCallback(async (id: string, updates: { fact?: string; active?: boolean }) => {
    const res = await fetch(`/api/memory/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      const entry = await res.json()
      setMemories((prev) => prev.map((m) => (m.id === id ? entry : m)))
      return entry
    }
    return null
  }, [])

  const deleteMemory = useCallback(async (id: string) => {
    const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setMemories((prev) => prev.filter((m) => m.id !== id))
    }
  }, [])

  const deleteAllMemories = useCallback(async () => {
    const res = await fetch('/api/memory', { method: 'DELETE' })
    if (res.ok) {
      setMemories([])
    }
  }, [])

  return { memories, loading, addMemory, updateMemory, deleteMemory, deleteAllMemories, fetchMemories }
}