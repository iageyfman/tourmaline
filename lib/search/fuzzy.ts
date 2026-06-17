/**
 * Tiny subsequence fuzzy ranker for the quick switcher. Returns items whose
 * query characters appear in order (case-insensitive), ranked: contiguous runs, a prefix
 * match, and word-boundary matches score higher. Empty query returns all items unchanged.
 */
export function fuzzyRank<T>(query: string, items: T[], key: (t: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const s = scoreMatch(q, key(item).toLowerCase());
    if (s !== null) scored.push({ item, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.item);
}

function scoreMatch(q: string, text: string): number | null {
  let qi = 0;
  let score = 0;
  let run = 0;
  let prev = -2;
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (text[i] !== q[qi]) continue;
    let pts = 1;
    if (i === prev + 1) {
      run += 1;
      pts += run * 2; // reward contiguous runs
    } else {
      run = 0;
    }
    if (i === 0) pts += 5; // prefix
    else if (/[\s_/\-]/.test(text[i - 1])) pts += 3; // word boundary
    score += pts;
    prev = i;
    qi += 1;
  }
  return qi === q.length ? score : null; // all query chars consumed, in order
}
