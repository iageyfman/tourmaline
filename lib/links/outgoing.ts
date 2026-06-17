/**
 * Outgoing-links panel types — the companion to backlinks: every link FROM a
 * note, resolved vs unresolved separated. Embeds (`![[X]]`) are outgoing links too and appear
 * in the same groups, tagged `isEmbed`. Built by `getOutgoingLinks` in lib/links/actions.ts.
 */
export interface ResolvedOut {
  targetId: string;
  title: string; // the live target's canonical title
  isEmbed: boolean; // true if ANY occurrence to this target was an embed
}

export interface UnresolvedOut {
  title: string; // raw target_title (the [[text]] that resolves to no note)
  isEmbed: boolean;
}

export interface OutgoingLinks {
  resolved: ResolvedOut[];
  unresolved: UnresolvedOut[];
}
