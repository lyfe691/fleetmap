"use client"

import { useState, useSyncExternalStore } from "react"
import { MapClient } from "@/components/map/map-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Fleet dashboard</CardTitle>
          <CardDescription>Enter the display code to connect.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const trimmed = input.trim()
              if (trimmed) setDisplayCode(trimmed)
            }}
          >
            <Field>
              <FieldLabel htmlFor="display-code">Display code</FieldLabel>
              <Input
                id="display-code"
                type="password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Display code"
                autoFocus
              />
            </Field>
            <Button type="submit" disabled={!input.trim()}>
              Connect
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
