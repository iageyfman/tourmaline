/**
 * Exit test — graph view + local graph, via the REAL `graphData` server
 * action over a known link topology seeded through the REAL save pipeline, plus the pure
 * `lib/graph/colors` units.
 *
 *   TOPOLOGY:  Hub →{Spoke A, Spoke B, Spoke C, Mid};  Mid → Leaf  (the 2-hop chain);
 *              Selfie → Selfie (self-link);  Orphan (no links);  Deleted → Hub (then soft-deleted);
 *              Filed (in S8Folder), Subfiled (in S8Sub), Tagged (#s8/special).
 *   FULL:      every live S8 note is a node; edges are resolved + non-self + soft-delete-excluded +
 *              deduped; degree = distinct-neighbor (Hub=4, Mid=2, spokes=1, Selfie=Orphan=0);
 *              folderId + tags[] carried.
 *   LOCAL:     depth 1 from Hub = Hub+spokes+Mid (Leaf excluded); depth 2 adds Leaf; orphan-center
 *              = lone node; depth CLAMPED to [1,2] (5 → depth 2, 0 → depth 1).
 *   COLORS:    null → neutral; distinct folders → distinct colors; deterministic.
 *
 * Scoped to its own `S8 *` titles (the live vault holds 40+ unrelated notes). Run:
 *   npx tsx scripts/exit-test-s8.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { saveNote } from "../lib/pipeline/save-note";
import { createFolder } from "../lib/folders/actions";
import { softDeleteNote } from "../lib/notes/actions";
import { graphData, type GraphData } from "../lib/graph/actions";
import { buildFolderColors, folderColor, NEUTRAL } from "../lib/graph/colors";

const TITLES = [
  "S8 Hub", "S8 Spoke A", "S8 Spoke B", "S8 Spoke C",
  "S8 Mid", "S8 Leaf", "S8 Selfie", "S8 Orphan",
  "S8 Deleted", "S8 Filed", "S8 Subfiled", "S8 Tagged",
];

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const titleSet = (g: GraphData) => new Set(g.nodes.map((n) => n.title));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env (SUPABASE_SERVICE_ROLE_KEY in .env.local).");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Clean prior runs: notes by title, then the S8 folders by name (names aren't unique).
  await db.from("notes").delete().in("title", TITLES);
  await db.from("folders").delete().in("name", ["S8Folder", "S8Sub"]);

  const seed = async (title: string, body: string, folderId: string | null = null) =>
    (await saveNote(db, { title, body, folderId })).id as string;

  // ── Seed the topology ──────────────────────────────────────────────────────────
  const hubId = await seed("S8 Hub", "#s8/hub links [[S8 Spoke A]] [[S8 Spoke B]] [[S8 Spoke C]] and [[S8 Mid]]");
  const spokeAId = await seed("S8 Spoke A", "spoke a body");
  const spokeBId = await seed("S8 Spoke B", "spoke b body");
  const spokeCId = await seed("S8 Spoke C", "spoke c body");
  const midId = await seed("S8 Mid", "the middle, points to [[S8 Leaf]]");
  const leafId = await seed("S8 Leaf", "the leaf, two hops from the hub");
  const selfieId = await seed("S8 Selfie", "[[S8 Selfie]] points at itself");
  const orphanId = await seed("S8 Orphan", "no links at all here");
  const deletedId = await seed("S8 Deleted", "[[S8 Hub]] from a soon-deleted note");

  const pf = await createFolder({ name: "S8Folder" });
  const sf = await createFolder({ name: "S8Sub", parentId: pf.id });
  const filedId = await seed("S8 Filed", "#s8/filed filed in a folder", pf.id);
  const subfiledId = await seed("S8 Subfiled", "in the subfolder", sf.id);
  const taggedId = await seed("S8 Tagged", "#s8/special a tagged note");

  await softDeleteNote(deletedId); // its node + its Deleted→Hub edge must both drop out

  const s8Ids = new Set([
    hubId, spokeAId, spokeBId, spokeCId, midId, leafId, selfieId, orphanId,
    filedId, subfiledId, taggedId, // deletedId intentionally excluded (soft-deleted)
  ]);

  // ── A. Full graph ────────────────────────────────────────────────────────────────
  console.log("\n=== A. Full graph (membership / exclusions / edges / degree / folder / tags) ===");
  const full = await graphData(null);
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const idTitle = new Map(full.nodes.map((n) => [n.id, n.title]));

  const liveS8 = [hubId, spokeAId, spokeBId, spokeCId, midId, leafId, selfieId, orphanId, filedId, subfiledId, taggedId];
  check(liveS8.every((id) => byId.has(id)), "every live S8 note appears as a node");
  check(!byId.has(deletedId), "soft-deleted note ('S8 Deleted') is excluded from the graph");

  // S8-internal edges as sorted "A | B" title pairs (canonical undirected).
  const s8EdgePairs = (g: GraphData) =>
    g.edges
      .filter((e) => s8Ids.has(e.source) && s8Ids.has(e.target))
      .map((e) => [idTitle.get(e.source), idTitle.get(e.target)].sort().join(" | "))
      .sort();
  const expectedFull = [
    "S8 Hub | S8 Mid",
    "S8 Hub | S8 Spoke A",
    "S8 Hub | S8 Spoke B",
    "S8 Hub | S8 Spoke C",
    "S8 Leaf | S8 Mid",
  ];
  check(eq(s8EdgePairs(full), expectedFull), `edges resolved/non-self/dedup/soft-delete-excluded → ${JSON.stringify(expectedFull)}`);

  check(byId.get(hubId)?.degree === 4, `Hub degree = 4 (distinct neighbors), got ${byId.get(hubId)?.degree}`);
  check(byId.get(midId)?.degree === 2, `Mid degree = 2, got ${byId.get(midId)?.degree}`);
  check(byId.get(spokeAId)?.degree === 1, `Spoke A degree = 1, got ${byId.get(spokeAId)?.degree}`);
  check(byId.get(leafId)?.degree === 1, `Leaf degree = 1, got ${byId.get(leafId)?.degree}`);
  check(byId.get(selfieId)?.degree === 0, `Selfie degree = 0 (self-link excluded), got ${byId.get(selfieId)?.degree}`);
  check(byId.get(orphanId)?.degree === 0, `Orphan degree = 0, got ${byId.get(orphanId)?.degree}`);

  check(byId.get(filedId)?.folderId === pf.id, "Filed note carries its folderId (S8Folder)");
  check(byId.get(subfiledId)?.folderId === sf.id, "Subfiled note carries its subfolder id (S8Sub)");
  check(byId.get(hubId)?.folderId === null, "unfiled Hub has folderId null");

  check((byId.get(hubId)?.tags ?? []).includes("s8/hub"), "Hub node carries tag 's8/hub'");
  check((byId.get(taggedId)?.tags ?? []).includes("s8/special"), "Tagged node carries 's8/special' (nested tag round-trips)");
  check((byId.get(filedId)?.tags ?? []).includes("s8/filed"), "Filed node carries 's8/filed'");
  check(eq(byId.get(orphanId)?.tags, []), "Orphan node has an empty tags array");

  // ── B. Local graph, depth 1 ────────────────────────────────────────────────────
  console.log("\n=== B. Local graph from Hub, depth 1 ===");
  const local1 = await graphData(hubId, 1);
  const t1 = titleSet(local1);
  check(["S8 Hub", "S8 Spoke A", "S8 Spoke B", "S8 Spoke C", "S8 Mid"].every((t) => t1.has(t)), "depth 1 includes Hub + its 4 direct neighbors");
  check(!t1.has("S8 Leaf"), "depth 1 EXCLUDES the 2-hop Leaf");
  check(eq(s8EdgePairs(local1), ["S8 Hub | S8 Mid", "S8 Hub | S8 Spoke A", "S8 Hub | S8 Spoke B", "S8 Hub | S8 Spoke C"]), "depth 1 induced edges = the 4 hub edges (no Mid–Leaf)");

  // ── C. Local graph, depth 2 ────────────────────────────────────────────────────
  console.log("\n=== C. Local graph from Hub, depth 2 ===");
  const local2 = await graphData(hubId, 2);
  const t2 = titleSet(local2);
  check(t2.has("S8 Leaf"), "depth 2 INCLUDES the 2-hop Leaf");
  check(eq(s8EdgePairs(local2), ["S8 Hub | S8 Mid", "S8 Hub | S8 Spoke A", "S8 Hub | S8 Spoke B", "S8 Hub | S8 Spoke C", "S8 Leaf | S8 Mid"]), "depth 2 induced edges add Mid–Leaf");

  // ── D. Orphan as center ──────────────────────────────────────────────────────────
  console.log("\n=== D. Orphan as center ===");
  const localOrphan = await graphData(orphanId, 2);
  check(localOrphan.nodes.length === 1 && localOrphan.nodes[0]?.id === orphanId, "orphan-center → exactly 1 node (itself)");
  check(localOrphan.edges.length === 0, "orphan-center → 0 edges");

  // ── E. Depth clamp [1,2] ───────────────────────────────────────────────────────
  console.log("\n=== E. Depth clamp ===");
  const ids = (g: GraphData) => new Set(g.nodes.map((n) => n.id));
  const clampHi = await graphData(hubId, 5);
  const clampLo = await graphData(hubId, 0);
  check(eq([...ids(clampHi)].sort(), [...ids(local2)].sort()), "graphData(hub, 5) clamps to depth 2");
  check(eq([...ids(clampLo)].sort(), [...ids(local1)].sort()), "graphData(hub, 0) clamps to depth 1");

  // ── F. colors.ts units ─────────────────────────────────────────────────────────
  console.log("\n=== F. lib/graph/colors units ===");
  const cm = buildFolderColors([{ id: "f1" }, { id: "f2" }]);
  check(folderColor(cm, null) === NEUTRAL, "folderColor(null) → neutral grey");
  check(folderColor(cm, "unknown") === NEUTRAL, "folderColor(unmapped id) → neutral grey");
  check(folderColor(cm, "f1") !== folderColor(cm, "f2"), "distinct folders get distinct colors");
  check(/^#[0-9a-f]{6}$/i.test(folderColor(cm, "f1")), "folder color is a hex string");
  check(buildFolderColors([{ id: "f1" }, { id: "f2" }]).get("f1") === cm.get("f1"), "color assignment is deterministic");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
