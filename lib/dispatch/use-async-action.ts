"use client"

import { useState } from "react"
import type { ActionResult } from "@/lib/dispatch/actions"

/** Dedupes the busy/error/on-success dance every dispatch mutation repeats. */
export function useAsyncAction(onSuccess: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<ActionResult>) => {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSuccess()
  }

  return { busy, error, run }
}
