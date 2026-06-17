import type { SaveState } from "./types";

export function SaveStatePill({ save }: { save: SaveState }) {
  if (save.status === "idle") return null;
  const text =
    save.status === "saving" ? "Saving…" : save.status === "saved" ? "Saved" : save.message;
  const color =
    save.status === "saved"
      ? "text-emerald-400"
      : save.status === "error"
        ? "text-red-400"
        : "text-neutral-500";
  return <span className={`text-xs ${color}`}>{text}</span>;
}
