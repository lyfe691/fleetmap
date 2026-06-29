"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Locale } from "@/lib/settings/types"
import { useTranslations } from "@/lib/i18n/index"

export function LanguageSection() {
  const { settings, setSetting } = useSettings()
  const t = useTranslations()

  return (
    <div className="flex flex-col">
      <SettingRow
        title={t("settings.language")}
        description={t("settings.language.desc")}
        control={
          <Select
            value={settings.locale}
            onValueChange={(v) => setSetting("locale", String(v) as Locale)}
          >
            <SelectTrigger className="w-[200px]" aria-label={t("settings.language")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="de-CH">Deutsch (Schweiz)</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}
