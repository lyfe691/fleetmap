"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Segmented } from "@/components/console/settings/segmented"
import type { Locale } from "@/lib/settings/types"

export function LanguageSection() {
  const { settings, setSetting } = useSettings()

  return (
    <div className="flex flex-col">
      <SettingRow
        title="Language"
        description="Choose the console display language."
        control={
          <Segmented
            ariaLabel="Language"
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
