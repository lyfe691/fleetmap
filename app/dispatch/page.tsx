import { DispatchGate } from "@/components/dispatch/dispatch-gate"

export default function DispatchPage() {
  return (
    <main className="h-screen w-screen overflow-y-auto">
      <DispatchGate />
    </main>
  )
}
