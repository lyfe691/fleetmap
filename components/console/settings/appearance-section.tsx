"use client"

import { useTheme } from "next-themes"
import { SettingRow } from "@/components/console/settings/setting-row"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n/index"

export function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations()

  // value -> label map; lets <SelectValue> resolve the trigger label.
  const items: Record<string, string> = {
    system: t("settings.theme.system"),
    light: t("settings.theme.light"),
    dark: t("settings.theme.dark"),
  }

  return (
    <div className="flex flex-col">
      <SettingRow
        title={t("settings.theme")}
        description={t("settings.theme.desc")}
        control={
          <Select
            items={items}
            value={theme ?? "system"}
            onValueChange={(v) => setTheme(String(v))}
          >
            <SelectTrigger className="w-[10rem]" aria-label={t("settings.theme")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="system">{items.system}</SelectItem>
                <SelectItem value="light">{items.light}</SelectItem>
                <SelectItem value="dark">{items.dark}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}
