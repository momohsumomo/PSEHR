/** Move the highlighted row in a list. Page size is how many rows fit in the scroller. */

export type ListNavKey =
  | "ArrowUp"
  | "ArrowDown"
  | "PageUp"
  | "PageDown"
  | "Home"
  | "End";

export function isListNavKey(key: string): key is ListNavKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End"
  );
}

export function isPageListNavKey(key: string): boolean {
  return key === "PageUp" || key === "PageDown" || key === "Home" || key === "End";
}

export function stepListIndex(
  key: ListNavKey,
  current: number,
  length: number,
  pageSize: number,
): number {
  if (length <= 0) return -1;
  const last = length - 1;
  const page = Math.max(1, pageSize);
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (current < 0) return key === "ArrowUp" || key === "PageUp" ? last : 0;
  if (key === "ArrowUp") return Math.max(0, current - 1);
  if (key === "ArrowDown") return Math.min(last, current + 1);
  if (key === "PageUp") return Math.max(0, current - page);
  return Math.min(last, current + page);
}

export function listPageSize(scroller: HTMLElement | null, fallbackRowPx = 20): number {
  if (!scroller) return 12;
  const header = scroller.querySelector("thead")?.getBoundingClientRect().height || 0;
  const row = scroller.querySelector<HTMLElement>("[data-list-row]")?.getBoundingClientRect().height;
  const rowPx = row && row > 0 ? row : fallbackRowPx;
  return Math.max(1, Math.floor((scroller.clientHeight - header) / rowPx));
}

function stickyHeader(scroller: HTMLElement): HTMLElement | null {
  return scroller.querySelector("thead");
}

/** The top row sits under the sticky header after scrollIntoView. Pull it back down into view. */
export function liftOffStickyHeader(scroller: HTMLElement, row: HTMLElement | null | undefined): void {
  if (!row) return;
  const header = stickyHeader(scroller);
  if (!header) return;
  const overlap = header.getBoundingClientRect().bottom - row.getBoundingClientRect().top;
  if (overlap > 0.5) scroller.scrollTop -= overlap;
}

function rowAt(scroller: HTMLElement, index: number): HTMLElement | undefined {
  const rows = scroller.querySelectorAll<HTMLElement>("[data-list-row]");
  return rows[index];
}

export function scrollListToIndex(
  scroller: HTMLElement,
  index: number,
  key: ListNavKey,
  rowPx?: number,
  fromIndex = -1,
): void {
  if (rowPx && rowPx > 0) {
    const top = index * rowPx;
    const headerH = stickyHeader(scroller)?.getBoundingClientRect().height || 0;
    if (key === "Home" || (index === 0 && key === "PageUp")) {
      scroller.scrollTop = 0;
    } else if (key === "End") {
      scroller.scrollTop = scroller.scrollHeight;
    } else if (key === "PageUp" || key === "PageDown") {
      const fromTop = (fromIndex >= 0 ? fromIndex : index) * rowPx;
      const rel = fromTop - scroller.scrollTop;
      scroller.scrollTop = Math.max(0, top - rel - (index === 0 ? 0 : headerH));
    } else {
      const view = scroller.clientHeight;
      const limit = top - (index === 0 ? 0 : headerH);
      if (limit < scroller.scrollTop) scroller.scrollTop = Math.max(0, limit);
      else if (top + rowPx > scroller.scrollTop + view) scroller.scrollTop = top - view + rowPx;
    }
    liftOffStickyHeader(scroller, rowAt(scroller, index));
    return;
  }

  const rows = scroller.querySelectorAll<HTMLElement>("[data-list-row]");
  const last = rows.length - 1;
  if (key === "Home" || (index === 0 && key === "PageUp")) {
    scroller.scrollTop = 0;
  } else if (key === "End" || (index === last && last >= 0 && key === "PageDown")) {
    scroller.scrollTop = scroller.scrollHeight;
  } else if ((key === "PageUp" || key === "PageDown") && rows[index]) {
    const cur = fromIndex >= 0 ? rows[fromIndex] : null;
    const rel = cur ? cur.offsetTop - scroller.scrollTop : 0;
    scroller.scrollTop = Math.max(0, rows[index].offsetTop - rel);
  } else {
    rows[index]?.scrollIntoView({ block: "nearest" });
  }
  liftOffStickyHeader(scroller, rows[index]);
}
