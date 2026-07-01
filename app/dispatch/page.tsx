import { DispatchGate } from "@/components/dispatch/dispatch-gate"
import { SettingsProvider } from "@/lib/settings/settings-provider"

export default function DispatchPage() {
  return (
    <SettingsProvider>
      <main className="min-h-screen w-screen">
        <DispatchGate />
      </main>
    </SettingsProvider>
  )
}
