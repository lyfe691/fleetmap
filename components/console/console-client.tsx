"use client"

import dynamic from "next/dynamic"

import { Spinner } from "@/components/ui/spinner"

export const ConsoleClient = dynamic(
  () => import("@/components/console/console-shell").then((m) => m.ConsoleShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    ),
  }
)
