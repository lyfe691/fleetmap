"use client"

import dynamic from "next/dynamic"

import { Spinner } from "@/components/ui/spinner"

// ssr:false must live in a client module (Next 16 forbids it from a Server
// Component); maplibre-gl reads window at module load.
export const MapClient = dynamic(
  () => import("./fleet-map").then((m) => m.FleetMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    ),
  }
)
