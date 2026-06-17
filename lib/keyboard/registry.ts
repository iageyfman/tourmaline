import { useEffect, useRef } from "react";

// Central keyboard-shortcut registry: register shortcuts in one place, don't
// scatter listeners. One window listener; handlers read from a ref so they stay current
// without re-binding. When a modal (e.g. the quick switcher) is open, global shortcuts are
// suppressed so the modal owns the keyboard.

export interface ShortcutHandlers {
  toggleMode?: () => void; // Cmd/Ctrl+E — edit/preview toggle
  newNote?: () => void; // Cmd/Ctrl+N — new note
  openSwitcher?: () => void; // Cmd/Ctrl+O — quick switcher
  dailyNote?: () => void; // Cmd/Ctrl+D — today's daily note
  openSearch?: () => void; // Cmd/Ctrl+Shift+F — full-text search
  openGraph?: () => void; // Cmd/Ctrl+Shift+G — graph view
}

export function useShortcuts(handlers: ShortcutHandlers, modalOpen = false): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const modalRef = useRef(modalOpen);
  modalRef.current = modalOpen;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (modalRef.current) return; // a modal owns the keyboard while open
      const key = e.key.toLowerCase();
      if (e.shiftKey && key === "f") {
        e.preventDefault(); // Cmd/Ctrl+Shift+F; plain Cmd+F is left to the browser's find
        ref.current.openSearch?.();
        return;
      }
      if (e.shiftKey && key === "g") {
        e.preventDefault(); // Cmd/Ctrl+Shift+G; plain Cmd+G is left to the browser's find-next
        ref.current.openGraph?.();
        return;
      }
      if (key === "e") {
        e.preventDefault();
        ref.current.toggleMode?.();
      } else if (key === "n") {
        e.preventDefault();
        ref.current.newNote?.();
      } else if (key === "o") {
        e.preventDefault();
        ref.current.openSwitcher?.();
      } else if (key === "d") {
        e.preventDefault(); // Cmd+D is browser "bookmark"; we own it
        ref.current.dailyNote?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
