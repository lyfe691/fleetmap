"use client"

import dynamic from "next/dynamic"

import { ConsoleSkeleton } from "@/components/console/console-skeleton"

export const ConsoleClient = dynamic(
  () => import("@/components/console/console-shell").then((m) => m.ConsoleShell),
  {
    ssr: false,
    loading: () => <ConsoleSkeleton />,
  }
)
