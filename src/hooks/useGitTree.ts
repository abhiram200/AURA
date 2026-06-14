import { useState, useCallback } from 'react'

export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: number
  parentHashes: string[]
  refs: string[]
}

export interface GitBranch {
  name: string
  isHead: boolean
  isRemote: boolean
  commitHash: string
}

export interface GitTreeData {
  commits: GitCommit[]
  branches: GitBranch[]
}

export function useGitTree(projectId: string) {
  const [data, setData] = useState<GitTreeData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)

  const fetchLog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspace/${projectId}/git-log?maxCount=100`)
      if (!res.ok) throw new Error('Failed to fetch git log')
      const json = await res.json()
      setData(json)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchCurrentBranch = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/git-branch`)
      if (res.ok) {
        const json = await res.json()
        setCurrentBranch(json.branch)
      }
    } catch { /* non-critical */ }
  }, [projectId])

  const checkout = useCallback(async (branch: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/git-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      })
      const result = await res.json()
      if (result.success) {
        await fetchLog()
        await fetchCurrentBranch()
      }
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }, [projectId, fetchLog, fetchCurrentBranch])

  const revert = useCallback(async (commitHash: string, strategy: 'revert' | 'reset'): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/git-revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitHash, strategy }),
      })
      const result = await res.json()
      if (result.success) {
        await fetchLog()
        await fetchCurrentBranch()
      }
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }, [projectId, fetchLog, fetchCurrentBranch])

  return {
    data,
    loading,
    error,
    currentBranch,
    fetchLog,
    fetchCurrentBranch,
    checkout,
    revert,
  }
}