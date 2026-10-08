// Keep legitimate loops as return edges; lay out the remaining directed graph.
export function layoutFlow(cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const edges = cards.flatMap((c) =>
    (c.links || [])
      .filter(
        (l) =>
          byId.has(l.targetId) &&
          (c.stage === 'contexts' ? l.kind === 'related' : l.kind === 'flow'),
      )
      .map((l) => ({ source: c.id, target: l.targetId })),
  );
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
  const adjacency = new Map([...connected].map((id) => [id, []]));
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return adjacency.get(from)?.some((id) => reaches(id, to, seen)) || false;
  };
  const routed = edges.map((e) => {
    const feedback = reaches(e.target, e.source);
    if (!feedback) adjacency.get(e.source).push(e.target);
    return { ...e, feedback };
  });
  const rank = new Map([...connected].map((id) => [id, 0]));
  const indegree = new Map([...connected].map((id) => [id, 0]));
  for (const targets of adjacency.values())
    for (const id of targets) indegree.set(id, indegree.get(id) + 1);
  const queue = [...connected].filter((id) => indegree.get(id) === 0);
  for (let i = 0; i < queue.length; i++)
    for (const target of adjacency.get(queue[i])) {
      rank.set(target, Math.max(rank.get(target), rank.get(queue[i]) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  const rows = new Map();
  const nodes = cards
    .filter((c) => connected.has(c.id))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((card) => {
      const col = rank.get(card.id),
        row = rows.get(col) || 0;
      rows.set(col, row + 1);
      return { id: card.id, x: 24 + col * 270, y: 36 + row * 152 };
    });
  return {
    nodes,
    edges: routed,
    width: Math.max(600, ...nodes.map((n) => n.x + 270)),
    height: Math.max(220, ...nodes.map((n) => n.y + 152)),
    unconnected: cards.filter((c) => !connected.has(c.id)).map((c) => c.id),
  };
}
