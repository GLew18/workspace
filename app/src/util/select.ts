// Cobalt: what a Shift+click does to a selection.
//
// ONE implementation for the Tasks list, the Bookmarks grid and both Focus lists.
// The three used to carry a copy each and they drifted — Bookmarks' copy could
// only ever ADD, so shift-clicking back over a range there quietly re-selected it
// instead of undoing it (Gabe, 8/20).
//
// THERE IS NO ANCHOR. That is the point of this file.
//
// Every version before this remembered "the last row you touched" and measured the
// range from there. The trouble is that a deselected row is still a row you
// touched, so the memory outlived the thing it described: deselect the two rows
// under a task, pick that task again, shift+click UPWARD, and the two rows below
// came back — they were never in the span you drew, but they were in the span the
// app was still remembering. Invisible state, and no way to see or clear it.
//
// So the range is measured from THE SELECTION ITSELF, which is on screen and can
// be pointed at:
//
//   • Shift+click OUTSIDE the selection → everything between the row you clicked
//     and the far end of the selection joins it. The selection always ends up a
//     single unbroken run between its extremes ("fill between the extremes", per
//     Gabe).
//   • Shift+click INSIDE the selection → the run is trimmed from that row to
//     whichever END is nearer, that row included. Clicking the last row drops just
//     it; clicking two thirds of the way down drops that third. This is how an
//     overshoot is taken back.
//   • Shift+click with nothing selected → selects that row, exactly like a click.
//
// Nothing here survives the selection emptying, because nothing here is stored.

/**
 * Apply a Shift+click on `clicked` to `sel`, in place.
 *
 * @param ids  every selectable id in VISIBLE order (the DOM order of the list).
 * @param sel  the live selection; mutated.
 */
export function shiftSelect(ids: string[], sel: Set<string>, clicked: string): void {
  const idx = ids.indexOf(clicked);
  if (idx < 0) {
    sel.add(clicked); // not in the visible list (a collapsed folder member)
    return;
  }
  // Where the selection currently reaches. Only VISIBLE members count: a row that
  // cannot be seen cannot be one of the ends the student is aiming between.
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < ids.length; i++) {
    if (!sel.has(ids[i])) continue;
    if (lo < 0) lo = i;
    hi = i;
  }
  if (lo < 0) {
    sel.add(clicked); // nothing selected yet — shift is just a click
    return;
  }
  if (!sel.has(clicked)) {
    // GROW: one unbroken run from the outermost end to the row clicked.
    for (let i = Math.min(idx, lo); i <= Math.max(idx, hi); i++) sel.add(ids[i]);
    return;
  }
  // TRIM: back off to the nearer end, taking the clicked row with it. Ties go to
  // the top, which only matters for a single-row selection (where both ends are
  // the same row anyway).
  if (idx - lo <= hi - idx) {
    for (let i = lo; i <= idx; i++) sel.delete(ids[i]);
  } else {
    for (let i = idx; i <= hi; i++) sel.delete(ids[i]);
  }
}
