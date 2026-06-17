import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

/**
 * CodeMirror completion source for wiki-links. Fires when the cursor
 * is right after an open, unclosed `[[` (before any `|`), offering note titles. Selecting
 * inserts `Title]]` and places the cursor after the closing brackets.
 *
 * Titles are read from a ref at completion time (not baked into the extension), so the
 * editor never reconfigures as notes change. Requires closeBrackets OFF so insertion is
 * deterministic (no auto-inserted `]]` to collide with).
 */
export function wikiComplete(titlesRef: { current: string[] }) {
  return (context: CompletionContext): CompletionResult | null => {
    // `[[` then any chars that are not `]` or `|`, anchored at the cursor.
    const before = context.matchBefore(/\[\[([^\]|]*)$/);
    if (!before) return null;

    const from = before.from + 2; // position just after `[[`
    const options: Completion[] = titlesRef.current.map((title) => ({
      label: title,
      type: "text",
      apply: (view: EditorView, _c: Completion, applyFrom: number, applyTo: number) => {
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert: `${title}]]` },
          selection: { anchor: applyFrom + title.length + 2 },
        });
      },
    }));

    return { from, options, filter: true };
  };
}
