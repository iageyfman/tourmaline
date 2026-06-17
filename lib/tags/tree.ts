// Build the nested tag tree for the tag pane (SPEC 2.3). Pure — splits `a/b/c` tag names
// into a hierarchy. Intermediate "pure-parent" nodes (a path segment that isn't itself an
// exact tag, e.g. `client` when only `client/toyota` exists) get ownCount 0; totalCount
// rolls descendants up so a parent can show a dimmed aggregate instead of looking empty.

export interface TagNode {
  name: string; // full path, e.g. "client/toyota"
  label: string; // last segment, e.g. "toyota"
  ownCount: number; // notes carrying this EXACT tag (0 for pure-parents)
  totalCount: number; // ownCount + all descendants' ownCount
  children: TagNode[];
}

export function buildTagTree(tags: { name: string; count: number }[]): TagNode[] {
  const roots: TagNode[] = [];
  const byPath = new Map<string, TagNode>();

  function ensure(path: string): TagNode {
    const existing = byPath.get(path);
    if (existing) return existing;
    const segments = path.split("/");
    const node: TagNode = {
      name: path,
      label: segments[segments.length - 1],
      ownCount: 0,
      totalCount: 0,
      children: [],
    };
    byPath.set(path, node);
    if (segments.length === 1) roots.push(node);
    else ensure(segments.slice(0, -1).join("/")).children.push(node);
    return node;
  }

  // Create nodes (auto-creating intermediate parents) and stamp exact-tag counts.
  for (const { name, count } of tags) ensure(name).ownCount = count;

  // Roll descendant counts up (post-order) and sort every level by full name.
  function roll(node: TagNode): number {
    node.totalCount = node.ownCount + node.children.reduce((sum, c) => sum + roll(c), 0);
    return node.totalCount;
  }
  function sortRec(nodes: TagNode[]): void {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  }
  roots.forEach(roll);
  sortRec(roots);
  return roots;
}
