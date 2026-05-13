/** Preset swatches for new labels (HSL for theme coherence). */
export const CRM_LABEL_COLOR_PRESETS = [
  "hsl(221 83% 53%)",
  "hsl(142 76% 36%)",
  "hsl(38 92% 45%)",
  "hsl(280 65% 48%)",
  "hsl(350 72% 48%)",
  "hsl(199 89% 42%)",
  "hsl(24 95% 53%)",
] as const;

export function crmLabelColorByIndex(i: number): string {
  return CRM_LABEL_COLOR_PRESETS[i % CRM_LABEL_COLOR_PRESETS.length]!;
}
