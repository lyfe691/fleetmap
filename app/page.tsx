import { LandingPage } from "@/components/landing/landing-page"
import { SettingsProvider } from "@/lib/settings/settings-provider"

// Front door: two authenticated surfaces now exist (the TV console and the
// dispatcher's order intake). Each destination still gates its own access
// (display code / dispatcher login) — this page does no auth itself.
export default function Page() {
  return (
    <SettingsProvider>
      <LandingPage />
    </SettingsProvider>
  )
}
