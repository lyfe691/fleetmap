import { Skeleton } from "@/components/ui/skeleton"

export function ConsoleSkeleton() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <aside className="flex w-[262px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2.5 w-28" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-3">
          <Skeleton className="mt-2 mb-1 h-3 w-14" />
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
          <Skeleton className="mt-3 mb-1 h-3 w-14" />
          <Skeleton className="h-9 w-full rounded-md" />
          <div className="mt-auto">
            <Skeleton className="h-[52px] w-full rounded-[14px]" />
          </div>
        </div>
      </aside>

      <section className="flex w-[380px] shrink-0 flex-col border-r border-border p-5">
        <Skeleton className="h-7 w-32" />
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[46px] flex-1 rounded-[13px]" />
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] w-full rounded-[18px]" />
          ))}
        </div>
      </section>

      <main className="flex-1 overflow-hidden p-7">
        <div className="mx-auto max-w-[820px] space-y-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-12 w-40 rounded-full" />
          </div>
          <Skeleton className="h-8 w-full" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-44 rounded-[20px]" />
            <Skeleton className="h-44 rounded-[20px]" />
          </div>
          <Skeleton className="h-[340px] w-full rounded-[20px]" />
        </div>
      </main>
    </div>
  )
}
