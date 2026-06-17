// Debounced autosave primitive. Keep the 1s autosave clock separate from
// the 5min revision clock, which lives server-side in the save_note RPC.
//
// The payload is captured at SCHEDULE time (closing over the note id it belongs to),
// so a pending save can never be misrouted to a different note after the user switches.
// flush() forces any pending save immediately — call it BEFORE switching the open note.

export interface Autosaver<T> {
  schedule(payload: T): void;
  flush(): Promise<void>;
}

export function createAutosaver<T>(opts: {
  delayMs: number;
  save: (payload: T) => Promise<void>;
}): Autosaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  async function fire(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const payload = pending;
    pending = null;
    await opts.save(payload);
  }

  return {
    schedule(payload: T) {
      pending = payload;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fire();
      }, opts.delayMs);
    },
    flush() {
      return fire();
    },
  };
}
