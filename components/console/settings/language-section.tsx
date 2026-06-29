"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Switch } from "@/components/ui/switch"
import type { Locale } from "@/lib/settings/types"
import { useTranslations } from "@/lib/i18n/index"

export function LanguageSection() {
  const { settings, setSetting } = useSettings()
  const t = useTranslations()
  const isDeCH = settings.locale === "de-CH"

  return (
    <div className="flex flex-col">
      <SettingRow
        title={t("settings.language")}
        description={t("settings.language.desc")}
        control={
          <div className="flex items-center gap-2">
            <span
              className={`text-[14px] ${isDeCH ? "text-muted-foreground" : "font-medium text-foreground"}`}
            >
              English
            </span>
            <Switch
              aria-label={t("settings.language")}
              checked={isDeCH}
              onCheckedChange={(on) =>
                setSetting("locale", (on ? "de-CH" : "en") as Locale)
              }
            />
            <span
              className={`text-[14px] ${isDeCH ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              Deutsch (Schweiz)
            </span>
          </div>
        }
      />
    </div>
  )
}
