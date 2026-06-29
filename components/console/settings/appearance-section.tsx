"use client"

import { useTheme } from "next-themes"
import { SettingRow } from "@/components/console/settings/setting-row"
import { Segmented } from "@/components/console/settings/segmented"

export function AppearanceSection() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col">
      <SettingRow
        title="Theme"
        description="Match the system or pick a fixed appearance."
        control={
          <Segmented
            ariaLabel="Theme"
            value={theme ?? "system"}
            onChange={setTheme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        }
      />
    </div>
  )
}
