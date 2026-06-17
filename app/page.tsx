import { listFolders } from "@/lib/folders/actions";
import { listNotesForTree } from "@/lib/notes/actions";
import { listViews } from "@/lib/views/actions";
import { AppShell } from "@/components/app-shell";

// Reads live folders/notes/views on each request (no static prerender; needs the DB).
export const dynamic = "force-dynamic";

export default async function Home() {
  const [folders, notes, views] = await Promise.all([
    listFolders(),
    listNotesForTree(),
    listViews(),
  ]);
  return <AppShell initialFolders={folders} initialNotes={notes} initialViews={views} />;
}
