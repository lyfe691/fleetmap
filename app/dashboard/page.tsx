import { DashboardGate } from "@/components/map/dashboard-gate"
import { SettingsProvider } from "@/lib/settings/settings-provider"

export default function DashboardPage() {
  return (
    <SettingsProvider>
      <main className="h-screen w-screen">
        <DashboardGate />
      </main>
    </SettingsProvider>
  )
}
