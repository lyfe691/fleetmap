"use client"

import dynamic from "next/dynamic"

import { ConsoleLoading } from "@/components/console/console-loading"

export const ConsoleClient = dynamic(
  () => import("@/components/console/console-shell").then((m) => m.ConsoleShell),
  {
    ssr: false,
    loading: () => <ConsoleLoading />,
  }
)
