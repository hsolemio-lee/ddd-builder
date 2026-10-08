// Ownership comes from contextId. Relationships never infer membership from titles or diagrams.
export function buildContextMap(contexts, members) {
  const ordered = [...contexts].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const ids = new Set(ordered.map((c) => c.id));
  const byId = new Map(members.map((c) => [c.id, c]));
  const groups = ordered.map((context) => ({
    context,
    members: members
      .filter((c) => c.contextId === context.id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
  }));
  const pairs = new Map();
  function direction(source, target) {
    const a = ordered.findIndex((c) => c.id === source),
      b = ordered.findIndex((c) => c.id === target);
    if (a < 0 || b < 0 || a === b) return;
    const first = ordered[Math.min(a, b)].id,
      second = ordered[Math.max(a, b)].id;
    const id = `${first}:${second}`;
    if (!pairs.has(id))
      pairs.set(id, {
        id,
        source: first,
        target: second,
        forward: { flows: [], declared: false },
        reverse: { flows: [], declared: false },
      });
    return pairs.get(id)[source === first ? 'forward' : 'reverse'];
  }
  for (const card of members)
    for (const link of card.links || []) {
      const target = byId.get(link.targetId);
      if (
        link.kind !== 'flow' ||
        card.stage !== 'events' ||
        target?.stage !== 'events'
      )
        continue;
      const lane = direction(card.contextId, target.contextId);
      if (
        lane &&
        !lane.flows.some((f) => f.source === card.id && f.target === target.id)
      )
        lane.flows.push({ source: card.id, target: target.id });
    }
  for (const context of ordered)
    for (const link of context.links || []) {
      if (link.kind !== 'related') continue;
      const lane = direction(context.id, link.targetId);
      if (lane) lane.declared = true;
    }
  return {
    groups,
    connections: [...pairs.values()],
    unassigned: members.filter((c) => !ids.has(c.contextId)),
  };
}

// Spacious two-column regions; diagonal edges travel through the space between regions.
export function layoutContextMap(groups, connections) {
  const nodes = groups.map((g, i) => ({
    id: g.context.id,
    x: 24 + (i % 2) * 454,
    y: 28 + Math.floor(i / 2) * 334,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = connections.map((connection) => {
    const a = byId.get(connection.source),
      b = byId.get(connection.target);
    if (a.y === b.y)
      return {
        ...connection,
        path: `M ${a.x + 320} ${a.y + 116} L ${b.x} ${b.y + 116}`,
        labelX: (a.x + 320 + b.x) / 2,
        labelY: a.y + 116,
      };
    if (a.x === b.x)
      return {
        ...connection,
        path: `M ${a.x + 160} ${a.y + 248} L ${b.x + 160} ${b.y}`,
        labelX: a.x + 160,
        labelY: (a.y + 248 + b.y) / 2,
      };
    const center = 411,
      mid = (a.y + 248 + b.y) / 2;
    const start = a.x === 24 ? a.x + 320 : a.x,
      end = b.x === 24 ? b.x + 320 : b.x;
    return {
      ...connection,
      path: `M ${start} ${a.y + 184} L ${center} ${a.y + 184} L ${center} ${b.y + 64} L ${end} ${b.y + 64}`,
      labelX: center,
      labelY: mid,
    };
  });
  return {
    nodes,
    edges,
    width: groups.length > 1 ? 822 : 368,
    height: Math.max(308, 28 + Math.ceil(groups.length / 2) * 334 - 58),
  };
}
