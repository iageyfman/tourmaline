// Deterministic folder → color mapping for the graph (nodes colored by
// folder). Pure; imports nothing; does no note-content parsing. Color is by DIRECT folder_id
// (max folder nesting is 2 — a top-level-ancestor rollup buys nothing). Unfiled notes
// (folder_id null) and any unmapped id fall back to a neutral grey.

const PALETTE = [
  "#38bdf8", // sky
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#fb7185", // rose
  "#2dd4bf", // teal
  "#fb923c", // orange
  "#e879f9", // fuchsia
  "#a3e635", // lime
  "#22d3ee", // cyan
  "#818cf8", // indigo
  "#f472b6", // pink
];

/** Neutral grey for unfiled notes (the majority) and any folder without a palette slot. */
export const NEUTRAL = "#6b7280";

/** Assign each folder a stable color from the palette, by its position in the input array. */
export function buildFolderColors(folders: { id: string }[]): Map<string, string> {
  const colors = new Map<string, string>();
  folders.forEach((f, i) => colors.set(f.id, PALETTE[i % PALETTE.length]));
  return colors;
}

/** Color for a note's folder; neutral grey for unfiled (null) or any unmapped folder id. */
export function folderColor(colors: Map<string, string>, folderId: string | null): string {
  if (!folderId) return NEUTRAL;
  return colors.get(folderId) ?? NEUTRAL;
}
