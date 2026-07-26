const SELECTION_CACHE_ATTR = "data-nova-radar-selection";

function persistSelection(): void {
  const value = window.getSelection()?.toString().trim() ?? "";
  if (value.length >= 20) {
    document.documentElement.setAttribute(SELECTION_CACHE_ATTR, value.slice(0, 40000));
  }
}

document.addEventListener("selectionchange", persistSelection, { passive: true });
document.addEventListener("mouseup", persistSelection, { passive: true });
persistSelection();
