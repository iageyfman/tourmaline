// Template variable substitution (SPEC 2.2). Pure string → string: the caller computes
// the values (date/time client-side in local TZ; title from the new note) and this only
// swaps tokens. It runs BEFORE the save pipeline parses, so a substituted [[link]], #tag,
// or frontmatter value is seen by the parser as real content (not the literal {{token}}).

export interface TemplateVars {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  title: string; // the new note's title (for a daily note, the date string)
}

/**
 * Replace {{date}} / {{time}} / {{title}} globally (optional inner whitespace tolerated,
 * e.g. {{ title }}). Any other {{...}} token is left untouched.
 */
export function substituteVars(body: string, vars: TemplateVars): string {
  return body
    .replace(/\{\{\s*date\s*\}\}/g, vars.date)
    .replace(/\{\{\s*time\s*\}\}/g, vars.time)
    .replace(/\{\{\s*title\s*\}\}/g, vars.title);
}
