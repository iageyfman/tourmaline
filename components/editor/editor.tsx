"use client";

import { useMemo, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { wikiComplete } from "@/lib/editor/wiki-complete";
import { maskCode, LINK_RE } from "@/lib/pipeline/parse";

/**
 * CodeMirror 6 markdown editor (dark). The PARENT remounts this per note via
 * `key={openNoteId}`, so we capture the body ONCE on mount and never feed live edits
 * back into `value` — that avoids the controlled-value feedback loop / cursor jumps.
 *
 * Extensions are built once per mount via useMemo so they can close over the stable refs
 * (`titlesRef` for autocomplete, `onWikiNavigateRef` for Cmd+click navigation) while staying
 * referentially stable — an inline array would force CodeMirror to reconfigure on every render.
 * closeBrackets is OFF so the autocomplete's `[[Title]]` insertion is deterministic.
 */
export function Editor({
  initialBody,
  onChange,
  titlesRef,
  onViewReady,
  onWikiNavigateRef,
}: {
  initialBody: string;
  onChange: (body: string) => void;
  titlesRef: { current: string[] };
  // Hands the live EditorView up so the outline (3.5) can scroll to a heading's line in edit
  // mode. onCreateEditor re-fires on every per-note remount (key), so the parent's ref is always
  // current — no stale-view bug across editorEpoch bumps.
  onViewReady?: (view: EditorView) => void;
  // Cmd/Ctrl+click on a [[link]] navigates. A ref (not
  // a direct callback) so the extension stays stable while always calling the latest handler.
  onWikiNavigateRef?: { current: (title: string) => void };
}) {
  const [initial] = useState(initialBody);
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      markdownLanguage.data.of({ autocomplete: wikiComplete(titlesRef) }),
      // Decoration-free hit-test (NO live preview): on a modified
      // click, find the [[link]] span under the cursor over a code-masked copy of the doc (so
      // clicks inside code are ignored) and open its target.
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const masked = maskCode(view.state.doc.toString());
          const re = new RegExp(LINK_RE.source, LINK_RE.flags);
          let m: RegExpExecArray | null;
          while ((m = re.exec(masked)) !== null) {
            if (pos >= m.index && pos < m.index + m[0].length) {
              const title = m[2].trim(); // group 2 = inner title (links aren't masked)
              if (title) {
                event.preventDefault();
                onWikiNavigateRef?.current?.(title);
                return true;
              }
              break;
            }
          }
          return false;
        },
      }),
    ],
    [titlesRef, onWikiNavigateRef],
  );
  return (
    <CodeMirror
      value={initial}
      onChange={onChange}
      theme={oneDark}
      extensions={extensions}
      height="100%"
      style={{ height: "100%" }}
      basicSetup={{ lineNumbers: false, foldGutter: false, closeBrackets: false }}
      onCreateEditor={(view) => onViewReady?.(view)}
    />
  );
}
