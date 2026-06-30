import { redirect } from "next/navigation"

// The standalone landing page is retired: the driver client moved to the native
// Bubblebox app, leaving the monitoring console as the only destination. Root
// forwards straight to it, so the first screen is the display-code gate.
export default function Page() {
  redirect("/dashboard")
}
