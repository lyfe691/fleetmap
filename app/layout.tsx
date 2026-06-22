import type { Metadata } from "next"
import {
  Bricolage_Grotesque,
  Instrument_Sans,
  JetBrains_Mono,
} from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const fontSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })
const fontHeading = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-heading",
})

export const metadata: Metadata = {
  title: "Fleetmap",
  description: "Real-time map of a delivery fleet.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        fontSans.variable,
        fontMono.variable,
        fontHeading.variable
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
