"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Locale } from "@/lib/settings/types"
import { useTranslations } from "@/lib/i18n/index"

// Autonyms (not translated); value -> label map for <SelectValue>.
const LANGUAGE_ITEMS: Record<string, string> = {
  en: "English",
  "de-CH": "Deutsch (Schweiz)",
}

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
            items={LANGUAGE_ITEMS}
            value={settings.locale}
            onValueChange={(v) => setSetting("locale", String(v) as Locale)}
          >
            <SelectTrigger className="w-[12.5rem]" aria-label={t("settings.language")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="en">{LANGUAGE_ITEMS.en}</SelectItem>
                <SelectItem value="de-CH">{LANGUAGE_ITEMS["de-CH"]}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}
