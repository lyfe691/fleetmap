export const en = {
  "settings.title": "Settings",
  "settings.cat.appearance": "Appearance",
  "settings.cat.accessibility": "Accessibility",
  "settings.cat.language": "Language",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.a11y.reduceMotion": "Reduce motion",
  "settings.a11y.reduceMotion.desc": "Turn off marker animation and transitions",
  "settings.a11y.largeText": "Larger text",
  "settings.a11y.largeText.desc": "Increase text size across the console",
  "settings.a11y.highContrast": "High contrast",
  "settings.a11y.highContrast.desc": "Stronger borders and text",
  "settings.a11y.bigTargets": "Bigger touch targets",
  "settings.a11y.bigTargets.desc": "Larger tap areas for touch",
  "settings.language": "Language",
} as const

export type TranslationKey = keyof typeof en
