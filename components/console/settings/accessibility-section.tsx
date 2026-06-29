"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Switch } from "@/components/ui/switch"
import { useTranslations } from "@/lib/i18n/index"
import type { TranslationKey } from "@/lib/i18n/en"

type BoolKey = "reduceMotion" | "highContrast"

const ROWS: { key: BoolKey; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  {
    key: "reduceMotion",
    titleKey: "settings.a11y.reduceMotion",
    descKey: "settings.a11y.reduceMotion.desc",
  },
  {
    key: "highContrast",
    titleKey: "settings.a11y.highContrast",
    descKey: "settings.a11y.highContrast.desc",
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
            <Switch
              aria-label={t(row.titleKey)}
              checked={settings[row.key]}
              onCheckedChange={(value) => setSetting(row.key, value)}
            />
          }
        />
      ))}
    </div>
  )
}
