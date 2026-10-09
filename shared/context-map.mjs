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

// Pack regions to the available width, keeping directly related regions nearby.
// Routes use a rectangular visibility grid so they do not cross ownership regions.
export function layoutContextMap(groups, connections, options = {}) {
  const ids = new Set(groups.map((g) => g.context.id));
  const valid = connections.filter(
    (c) => ids.has(c.source) && ids.has(c.target) && c.source !== c.target,
  );
  const columns = Math.max(
    1,
    Math.min(
      groups.length || 1,
      Math.floor(((options.width || 1100) - 16) / 432),
    ),
  );
  const slots = groups.map((_, i) => ({
    x: 64 + (i % columns) * 432,
    y: 64 + Math.floor(i / columns) * 368,
  }));
  const placed = new Map();
  const adjacent = new Map(groups.map((g) => [g.context.id, []]));
  valid.forEach((c) => {
    adjacent.get(c.source).push(c.target);
    adjacent.get(c.target).push(c.source);
  });
  const ordered = [...groups].sort(
    (a, b) =>
      adjacent.get(b.context.id).length - adjacent.get(a.context.id).length,
  );
  for (const group of ordered) {
    const neighbors = adjacent
      .get(group.context.id)
      .filter((id) => placed.has(id));
    const score = (slot) =>
      neighbors.reduce(
        (sum, id) =>
          sum +
          Math.abs(slot.x - placed.get(id).x) +
          Math.abs(slot.y - placed.get(id).y),
        0,
      );
    slots.sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
    placed.set(group.context.id, slots.shift());
  }
  const nodes = groups.map((g) => ({
    id: g.context.id,
    ...placed.get(g.context.id),
    ...options.positions?.[g.context.id],
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const labels = [];
  const edges = valid.map((connection, i) => {
    const a = byId.get(connection.source),
      b = byId.get(connection.target);
    const points = routeRegions(a, b, nodes, 24 + (i % 8) * 3);
    const segments = points
      .slice(1)
      .map((point, j) => ({
        a: points[j],
        b: point,
        length:
          Math.abs(point.x - points[j].x) + Math.abs(point.y - points[j].y),
      }))
      .sort((a, b) => b.length - a.length);
    let label;
    for (const segment of segments) {
      if (segment.length < 68) continue;
      for (const ratio of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const candidate = {
          x: segment.a.x + (segment.b.x - segment.a.x) * ratio,
          y: segment.a.y + (segment.b.y - segment.a.y) * ratio,
        };
        if (
          !labels.some(
            (p) =>
              Math.abs(p.x - candidate.x) < 76 &&
              Math.abs(p.y - candidate.y) < 28,
          ) &&
          !nodes.some(
            (n) =>
              candidate.x + 38 > n.x &&
              candidate.x - 38 < n.x + 320 &&
              candidate.y + 14 > n.y &&
              candidate.y - 14 < n.y + 248,
          )
        ) {
          label = candidate;
          break;
        }
      }
      if (label) break;
    }
    label ||= {
      x: (segments[0].a.x + segments[0].b.x) / 2,
      y: (segments[0].a.y + segments[0].b.y) / 2,
    };
    labels.push(label);
    return {
      ...connection,
      path: points.map((p, j) => `${j ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
      labelX: label.x,
      labelY: label.y,
    };
  });
  return {
    nodes,
    edges,
    width: Math.max(448, ...nodes.map((n) => n.x + 384)),
    height: Math.max(376, ...nodes.map((n) => n.y + 312)),
  };
}

function routeRegions(source, target, nodes, padding) {
  const ports = (n) => [
    [{ x: n.x + 160, y: n.y }, { x: n.x + 160, y: n.y - padding }, 1],
    [
      { x: n.x + 320, y: n.y + 124 },
      { x: n.x + 320 + padding, y: n.y + 124 },
      0,
    ],
    [
      { x: n.x + 160, y: n.y + 248 },
      { x: n.x + 160, y: n.y + 248 + padding },
      1,
    ],
    [{ x: n.x, y: n.y + 124 }, { x: n.x - padding, y: n.y + 124 }, 0],
  ];
  const starts = ports(source),
    ends = ports(target);
  const xs = [
    ...new Set(
      nodes.flatMap((n) => [n.x - padding, n.x + 160, n.x + 320 + padding]),
    ),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set(
      nodes.flatMap((n) => [n.y - padding, n.y + 124, n.y + 248 + padding]),
    ),
  ].sort((a, b) => a - b);
  const inside = (p) =>
    nodes.some(
      (n) => p.x > n.x && p.x < n.x + 320 && p.y > n.y && p.y < n.y + 248,
    );
  const clear = (a, b) =>
    !nodes.some((n) =>
      a.x === b.x
        ? a.x > n.x &&
          a.x < n.x + 320 &&
          Math.max(a.y, b.y) > n.y &&
          Math.min(a.y, b.y) < n.y + 248
        : a.y > n.y &&
          a.y < n.y + 248 &&
          Math.max(a.x, b.x) > n.x &&
          Math.min(a.x, b.x) < n.x + 320,
    );
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const heap = [];
  function push(item) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (heap[parent].priority <= item.priority) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = item;
  }
  function pop() {
    const first = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < heap.length &&
          heap[child + 1].priority < heap[child].priority
        )
          child++;
        if (last.priority <= heap[child].priority) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first;
  }
  const best = new Map();
  const enqueue = (state) => {
    const key = `${state.x}:${state.y}:${state.direction}`;
    if ((best.get(key) ?? Infinity) <= state.cost) return;
    best.set(key, state.cost);
    const point = { x: xs[state.x], y: ys[state.y] };
    push({
      ...state,
      key,
      priority:
        state.cost + Math.min(...ends.map(([, exit]) => distance(point, exit))),
    });
  };
  starts.forEach(([port, exit, direction]) => {
    if (!inside(exit))
      enqueue({
        x: xs.indexOf(exit.x),
        y: ys.indexOf(exit.y),
        direction,
        cost: padding,
        previous: null,
        port,
      });
  });
  while (heap.length) {
    const current = pop();
    if (best.get(current.key) !== current.cost) continue;
    const point = { x: xs[current.x], y: ys[current.y] };
    const end = ends.find(
      ([, exit]) => exit.x === point.x && exit.y === point.y,
    );
    if (end) {
      const path = [end[0]];
      let state = current;
      while (state) {
        path.push({ x: xs[state.x], y: ys[state.y] });
        if (!state.previous) path.push(state.port);
        state = state.previous;
      }
      path.reverse();
      return path.filter(
        (p, i) =>
          i === 0 ||
          i === path.length - 1 ||
          !(
            (path[i - 1].x === p.x && p.x === path[i + 1].x) ||
            (path[i - 1].y === p.y && p.y === path[i + 1].y)
          ),
      );
    }
    for (const [dx, dy, direction] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 1],
      [0, -1, 1],
    ]) {
      const x = current.x + dx,
        y = current.y + dy;
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const next = { x: xs[x], y: ys[y] };
      if (inside(next) || !clear(point, next)) continue;
      enqueue({
        x,
        y,
        direction,
        cost:
          current.cost +
          distance(point, next) +
          (direction === current.direction ? 0 : 28),
        previous: current,
      });
    }
  }
  // Only overlapping manually placed regions can prevent an exterior route.
  return [
    { x: source.x + 320, y: source.y + 124 },
    { x: target.x, y: target.y + 124 },
  ];
}
