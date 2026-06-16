"use client"

import dynamic from "next/dynamic"

// ssr:false must live in a client module (Next 16 forbids it from a Server
// Component); maplibre-gl reads window at module load.
export const MapClient = dynamic(
  () => import("./fleet-map").then((m) => m.FleetMap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-neutral-100" />,
  }
)
