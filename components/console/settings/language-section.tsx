"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Segmented } from "@/components/console/settings/segmented"
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
          <Segmented
            ariaLabel={t("settings.language")}
            value={settings.locale}
            onChange={(value) => setSetting("locale", value as Locale)}
            options={[
              { value: "en", label: "English" },
              { value: "de-CH", label: "Deutsch (Schweiz)" },
            ]}
          />
        }
      />
    </div>
  )
}
