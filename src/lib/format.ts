import { formatDistanceToNowStrict, format } from "date-fns";
import type { ISODate } from "./types";

export function fmtCurrency(n?: number, currency = "USD") {
  if (n == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtNumber(n?: number) {
  if (n == null) return "-";
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtPercent(n?: number, digits = 0) {
  if (n == null || Number.isNaN(n)) return "-";
  return `${n.toFixed(digits)}%`;
}

export function fmtDate(iso?: ISODate, pattern = "MMM d, yyyy") {
  if (!iso) return "-";
  try {
    return format(new Date(iso), pattern);
  } catch {
    return "-";
  }
}

export function fmtRelative(iso?: ISODate) {
  if (!iso) return "-";
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return "-";
  }
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
