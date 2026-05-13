/**
 * Base UI `<SelectValue>` does not reliably mirror `<SelectItem>` text on the closed trigger.
 * Pass these return values as `SelectValue` children for id- or key-backed selects.
 */

export function selectTriggerLabelById<T extends { id: string; label: string }>(
  value: string | undefined,
  items: readonly T[],
): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return items.find((x) => x.id === v)?.label;
}

export function selectTriggerLabelByIdName<T extends { id: string; name: string }>(
  value: string | undefined,
  items: readonly T[],
  fallback?: (id: string) => string | undefined,
): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return items.find((x) => x.id === v)?.name ?? fallback?.(v);
}

export function selectTriggerLabelByKey<K extends string>(
  value: string | undefined,
  entries: readonly { key: K; label: string }[],
): string | undefined {
  const v = value?.trim() as K;
  if (!v) return undefined;
  return entries.find((e) => e.key === v)?.label;
}

export function leadPickerTriggerLabel(
  leadId: string | undefined,
  leads: readonly { id: string; contactName: string; companyName: string }[],
): string | undefined {
  const id = leadId?.trim();
  if (!id) return undefined;
  const l = leads.find((x) => x.id === id);
  return l ? `${l.contactName} · ${l.companyName}` : undefined;
}

/** Optional-lead selects that use a sentinel value (e.g. `"__none__"`) instead of empty string. */
export function leadPickerTriggerLabelWithSentinel(
  rawValue: string | undefined,
  sentinel: string,
  noneLabel: string,
  leads: readonly { id: string; contactName: string; companyName: string }[],
): string | undefined {
  if (!rawValue || rawValue === sentinel) return noneLabel;
  return leadPickerTriggerLabel(rawValue, leads);
}

/** Short enum tokens (e.g. profile `type`) shown capitalized in select triggers. */
export function capitalizeSelectToken(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return v.charAt(0).toUpperCase() + v.slice(1);
}
