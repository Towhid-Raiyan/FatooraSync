// The A4 note box is sized for roughly 2 lines / ~40 words. Rather than validating
// note length at save time (the field is shared with the thermal design, which has
// no such limit), truncate for display only -- long notes are still saved in full,
// just clipped in the A4 render so the fixed-height box never overlaps the totals
// block below it.
const MAX_NOTE_CHARS = 220;

export function truncateNote(notes: string): string {
  if (notes.length <= MAX_NOTE_CHARS) return notes;
  return notes.slice(0, MAX_NOTE_CHARS).trimEnd() + "…";
}
