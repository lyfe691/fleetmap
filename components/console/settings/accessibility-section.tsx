"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Toggle } from "@/components/console/settings/toggle"

type BoolKey = "reduceMotion" | "largeText" | "highContrast" | "bigTargets"

const ROWS: { key: BoolKey; title: string; description: string }[] = [
  {
    key: "reduceMotion",
    title: "Reduce motion",
    description: "Minimize animations and marker movement.",
  },
  {
    key: "largeText",
    title: "Larger text",
    description: "Increase the interface text size.",
  },
  {
    key: "highContrast",
    title: "High contrast",
    description: "Stronger borders and text contrast.",
  },
  {
    key: "bigTargets",
    title: "Bigger touch targets",
    description: "Enlarge buttons and controls for touch.",
  },
]

export function AccessibilitySection() {
  const { settings, setSetting } = useSettings()

  return (
    <div className="flex flex-col">
      {ROWS.map((row) => (
        <SettingRow
          key={row.key}
          title={row.title}
          description={row.description}
          control={
            <Toggle
              label={row.title}
              checked={settings[row.key]}
              onChange={(value) => setSetting(row.key, value)}
            />
          }
        />
      ))}
    </div>
  )
}
