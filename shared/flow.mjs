// Keep legitimate loops as return edges; lay out the remaining directed graph.
export function layoutFlow(cards, options = {}) {
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
  const ordered = cards
    .filter((c) => connected.has(c.id))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const neighbors = new Map([...connected].map((id) => [id, []]));
  for (const edge of routed) {
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  }
  const visited = new Set(),
    components = [];
  for (const card of ordered) {
    if (visited.has(card.id)) continue;
    const component = [card.id];
    visited.add(card.id);
    for (let i = 0; i < component.length; i++)
      for (const id of neighbors.get(component[i]))
        if (!visited.has(id)) {
          visited.add(id);
          component.push(id);
        }
    components.push(new Set(component));
  }
  const overhead = routed.filter(
    (e) => e.feedback || rank.get(e.target) - rank.get(e.source) > 1,
  );
  let offset = 36 + overhead.length * 24;
  const nodes = [];
  for (const component of components) {
    const layers = new Map();
    for (const card of ordered.filter((c) => component.has(c.id))) {
      const col = rank.get(card.id);
      if (!layers.has(col)) layers.set(col, []);
      layers.get(col).push(card.id);
    }
    const columns = [...layers.keys()].sort((a, b) => a - b);
    // Neighbor ordering reduces crossings; separate components keep unrelated
    // stories from being interleaved by card creation order.
    for (let pass = 0; pass < 4; pass++) {
      const forward = pass % 2 === 0;
      for (const col of forward ? columns : [...columns].reverse()) {
        const positions = new Map(
          [...layers.values()].flatMap((ids) => ids.map((id, i) => [id, i])),
        );
        const score = (id) => {
          const adjacent = routed
            .filter(
              (e) =>
                !e.feedback && (forward ? e.target === id : e.source === id),
            )
            .map((e) => (forward ? e.source : e.target));
          return adjacent.length
            ? adjacent.reduce((sum, target) => sum + positions.get(target), 0) /
                adjacent.length
            : positions.get(id);
        };
        layers.get(col).sort((a, b) => score(a) - score(b));
      }
    }
    const rows = Math.max(...[...layers.values()].map((ids) => ids.length));
    for (const [col, ids] of layers)
      ids.forEach((id, row) =>
        nodes.push({
          id,
          x: 24 + col * 286,
          y: offset + (row + (rows - ids.length) / 2) * 144,
        }),
      );
    offset += rows * 144 + 32;
  }
  const horizontalWidth = Math.max(320, ...nodes.map((n) => n.x + 248));
  const horizontalHeight = Math.max(180, ...nodes.map((n) => n.y + 144));
  const verticalWidth = Math.max(
    320,
    ...nodes.map(
      (n) =>
        36 +
        overhead.length * 24 +
        ((n.y - 36 - overhead.length * 24) / 144) * 260 +
        248,
    ),
  );
  const verticalHeight = Math.max(
    180,
    ...nodes.map((n) => 24 + ((n.x - 24) / 286) * 176 + 144),
  );
  const fit = (w, h) => Math.min((options.width || 1100) / w, 650 / h);
  const vertical =
    options.direction === 'vertical' ||
    (options.direction !== 'horizontal' &&
      fit(verticalWidth, verticalHeight) >
        fit(horizontalWidth, horizontalHeight));
  if (vertical)
    for (const node of nodes) {
      const x =
        36 +
        overhead.length * 24 +
        ((node.y - 36 - overhead.length * 24) / 144) * 260;
      node.y = 24 + ((node.x - 24) / 286) * 176;
      node.x = x;
    }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const paths = routed.map((edge) => {
    const a = nodeById.get(edge.source),
      b = nodeById.get(edge.target);
    const lane = overhead.indexOf(edge);
    let path;
    if (vertical) {
      const sx = a.x + 112,
        sy = a.y + 112,
        tx = b.x + 112,
        ty = b.y;
      path =
        lane >= 0
          ? `M ${sx} ${sy} L ${sx} ${sy + 18} L ${20 + lane * 24} ${sy + 18} L ${20 + lane * 24} ${ty - 18} L ${tx} ${ty - 18} L ${tx} ${ty}`
          : `M ${sx} ${sy} C ${sx} ${(sy + ty) / 2}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`;
    } else {
      const start = a.x + 224,
        end = b.x,
        sy = a.y + 56,
        ty = b.y + 56;
      path =
        lane >= 0
          ? `M ${start} ${sy} L ${start + 18} ${sy} L ${start + 18} ${20 + lane * 24} L ${end - 18} ${20 + lane * 24} L ${end - 18} ${ty} L ${end} ${ty}`
          : `M ${start} ${sy} C ${(start + end) / 2} ${sy}, ${(start + end) / 2} ${ty}, ${end} ${ty}`;
    }
    return { ...edge, path };
  });
  return {
    nodes,
    edges: paths,
    direction: vertical ? 'vertical' : 'horizontal',
    width: Math.max(320, ...nodes.map((n) => n.x + 248)),
    height: Math.max(180, ...nodes.map((n) => n.y + 144)),
    unconnected: cards.filter((c) => !connected.has(c.id)).map((c) => c.id),
  };
}
