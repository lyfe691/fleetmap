"use client"

import { useTheme } from "next-themes"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Segmented } from "@/components/console/settings/segmented"
import { useTranslations } from "@/lib/i18n/index"

export function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations()

  return (
    <div className="flex flex-col">
      <SettingRow
        title={t("settings.theme")}
        description={t("settings.theme.desc")}
        control={
          <Segmented
            ariaLabel={t("settings.theme")}
            value={theme ?? "system"}
            onChange={setTheme}
            options={[
              { value: "system", label: t("settings.theme.system") },
              { value: "light", label: t("settings.theme.light") },
              { value: "dark", label: t("settings.theme.dark") },
            ]}
          />
        }
      />
    </div>
  )
}
