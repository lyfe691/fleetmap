import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function Page() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Fleetmap</CardTitle>
          <CardDescription>Real-time map of a delivery fleet.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Link href="/dashboard" className={buttonVariants()}>
            Open dashboard
          </Link>
          <Link
            href="/driver"
            className={buttonVariants({ variant: "outline" })}
          >
            Driver app
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
