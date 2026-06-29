"use client"

import { useTheme } from "next-themes"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Switch } from "@/components/ui/switch"
import { useTranslations } from "@/lib/i18n/index"

export function AppearanceSection() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const t = useTranslations()

  const isAutomatic = theme === "system"
  const isDark = resolvedTheme === "dark"

  return (
    <div className="flex flex-col">
      <SettingRow
        title={t("settings.theme.automatic")}
        description={t("settings.theme.automatic.desc")}
        control={
          <Switch
            aria-label={t("settings.theme.automatic")}
            checked={isAutomatic}
            onCheckedChange={(on) =>
              on ? setTheme("system") : setTheme(isDark ? "dark" : "light")
            }
          />
        }
      />
      <SettingRow
        title={t("settings.theme.darkMode")}
        description={t("settings.theme.darkMode.desc")}
        control={
          <Switch
            aria-label={t("settings.theme.darkMode")}
            checked={isDark}
            disabled={isAutomatic}
            onCheckedChange={(on) => setTheme(on ? "dark" : "light")}
          />
        }
      />
    </div>
  )
}
