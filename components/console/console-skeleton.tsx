import { Skeleton } from "@/components/ui/skeleton"

// Generic 3-region loading frame. Intentionally loose (not pixel-matched to each
// card) so small layout tweaks don't make it look stale.
export function ConsoleSkeleton() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <div className="flex w-[262px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4">
        <div className="flex items-center gap-3 pb-3">
          <Skeleton className="size-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-2.5">
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-2xl" />
        </div>
      </div>

      <div className="flex w-[380px] shrink-0 flex-col gap-4 border-r border-border p-5">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[54px] flex-1 rounded-[14px]" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[116px] w-full rounded-[18px]" />
          ))}
        </div>
      </div>

      <div className="flex-1 p-8">
        <div className="mx-auto w-full max-w-[860px] space-y-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-14 w-44 rounded-full" />
          </div>
          <Skeleton className="h-10 w-72" />
          <div className="grid grid-cols-2 gap-5">
            <Skeleton className="h-48 rounded-[20px]" />
            <Skeleton className="h-48 rounded-[20px]" />
          </div>
          <Skeleton className="h-[400px] w-full rounded-[20px]" />
        </div>
      </div>
    </div>
  )
}
