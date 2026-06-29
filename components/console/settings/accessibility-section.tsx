"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Toggle } from "@/components/console/settings/toggle"
import { useTranslations } from "@/lib/i18n/index"
import type { TranslationKey } from "@/lib/i18n/en"

type BoolKey = "reduceMotion" | "largeText" | "highContrast" | "bigTargets"

const ROWS: { key: BoolKey; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  {
    key: "reduceMotion",
    titleKey: "settings.a11y.reduceMotion",
    descKey: "settings.a11y.reduceMotion.desc",
  },
  {
    key: "largeText",
    titleKey: "settings.a11y.largeText",
    descKey: "settings.a11y.largeText.desc",
  },
  {
    key: "highContrast",
    titleKey: "settings.a11y.highContrast",
    descKey: "settings.a11y.highContrast.desc",
  },
  {
    key: "bigTargets",
    titleKey: "settings.a11y.bigTargets",
    descKey: "settings.a11y.bigTargets.desc",
  },
]

export function AccessibilitySection() {
  const { settings, setSetting } = useSettings()
  const t = useTranslations()

  return (
    <div className="flex flex-col">
      {ROWS.map((row) => (
        <SettingRow
          key={row.key}
          title={t(row.titleKey)}
          description={t(row.descKey)}
          control={
            <Toggle
              label={t(row.titleKey)}
              checked={settings[row.key]}
              onChange={(value) => setSetting(row.key, value)}
            />
          }
        />
      ))}
    </div>
  )
}
