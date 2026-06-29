"use client"

import { useTheme } from "next-themes"
import { SettingRow } from "@/components/console/settings/setting-row"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
          <Select value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
            <SelectTrigger className="w-[160px]" aria-label={t("settings.theme")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
              <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
              <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}
