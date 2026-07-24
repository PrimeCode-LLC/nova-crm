import { MODULE_BY_HREF } from "@/lib/permissions/catalog";

/** Longest matching catalog href for the current path (e.g. /leads/abc → /leads). */
export function resolveModuleHrefForPath(pathname: string): string | null {
  const path = pathname.split("?")[0] || "/";
  let best: string | null = null;
  for (const href of Object.keys(MODULE_BY_HREF)) {
    if (path === href || path.startsWith(`${href}/`)) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}
