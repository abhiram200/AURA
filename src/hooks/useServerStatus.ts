import { useState, useEffect } from 'react'

interface ServerStatus {
  serverOnline: boolean
  ollamaOnline: boolean
}

export function useServerStatus(intervalMs = 15000): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>({ serverOnline: false, ollamaOnline: false })

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health')
        if (res.ok) {
          const data = await res.json()
          setStatus({ serverOnline: true, ollamaOnline: !!data.ollama })
        } else {
          setStatus({ serverOnline: false, ollamaOnline: false })
        }
      } catch {
        setStatus({ serverOnline: false, ollamaOnline: false })
      }
    }

    check()
    const id = setInterval(check, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return status
}