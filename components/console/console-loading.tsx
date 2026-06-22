import { BubbleboxLogo } from "@/components/console/bubblebox-logo"

// Branded loading state for the console chunk. Deliberately NOT a layout-mirroring
// skeleton — that drifts out of sync on every layout change. This stays correct.
export function ConsoleLoading() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-background">
      <div className="relative flex size-20 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-muted border-t-foreground/50" />
        <BubbleboxLogo className="size-10 text-foreground" />
      </div>
      <div className="text-center">
        <div className="font-heading text-2xl font-semibold tracking-tight">
          Fleetmap
        </div>
        <div className="mt-1.5 text-[15px] text-muted-foreground">
          Loading the fleet…
        </div>
      </div>
    </div>
  )
}
