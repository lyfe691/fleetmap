"use client"

import { useState, useSyncExternalStore } from "react"
import { MapClient } from "@/components/map/map-client"
import {
  getDisplayCode,
  setDisplayCode,
  subscribeDisplayCode,
} from "@/lib/dashboard-code"

export function DashboardGate() {
  const code = useSyncExternalStore(
    subscribeDisplayCode,
    getDisplayCode,
    () => null
  )
  const [input, setInput] = useState("")

  if (code) {
    return <MapClient displayCode={code} />
  }

  return (
    <form
      className="flex h-full w-full items-center justify-center bg-neutral-950"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = input.trim()
        if (trimmed) setDisplayCode(trimmed)
      }}
    >
      <div className="flex w-72 flex-col gap-3 rounded-lg bg-white p-6 shadow">
        <h1 className="text-lg font-semibold">Fleet dashboard</h1>
        <p className="text-sm text-neutral-500">
          Enter the display code to connect.
        </p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="display code"
          autoFocus
          className="rounded border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white"
        >
          Connect
        </button>
      </div>
    </form>
  )
}
