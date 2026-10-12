import test from 'node:test';
import assert from 'node:assert/strict';
import { syncWorkspace } from '../src/workspace-sync.ts';

const user = { id: 'member', name: '참여자', email: 'member@example.test' };
const workspace = { projects: [], cards: [] };
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class Stream extends EventTarget {
  onerror = null;
  closed = false;
  close() {
    this.closed = true;
  }
  emit(type, value) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) }));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}
function harness(options = {}) {
  let now = 0,
    available = options.available ?? true,
    watcher;
  const timers = new Set(),
    streams = [],
    states = [],
    users = [],
    signals = [];
  const counts = { session: 0, state: 0, unauthorized: 0, disconnected: 0 };
  const stop = syncWorkspace(
    {
      open() {
        const stream = new Stream();
        streams.push(stream);
        if (options.onOpen) queueMicrotask(() => options.onOpen(stream));
        return stream;
      },
      async session(signal) {
        counts.session++;
        signals.push(signal);
        return options.session ? options.session(signal) : user;
      },
      async state(signal) {
        counts.state++;
        signals.push(signal);
        return options.state ? options.state(signal) : workspace;
      },
    },
    {
      state: (value, live) => states.push({ value, live }),
      user: (value) => users.push(value),
      presence() {},
      disconnected() {
        counts.disconnected++;
      },
      unauthorized() {
        counts.unauthorized++;
      },
      invalidState() {
        assert.fail('Unexpected malformed state');
      },
    },
    {
      available: () => available,
      now: () => now,
      random: () => 0,
      schedule(callback, delay) {
        const timer = { at: now + delay, callback };
        timers.add(timer);
        return () => timers.delete(timer);
      },
      watch(callback) {
        watcher = callback;
        return () => {
          watcher = undefined;
        };
      },
    },
  );
  return {
    stop,
    streams,
    counts,
    states,
    users,
    signals,
    availability(value) {
      available = value;
      watcher?.();
    },
    async advance(ms) {
      await flush();
      const target = now + ms;
      while (true) {
        const timer = [...timers].sort((a, b) => a.at - b.at)[0];
        if (!timer || timer.at > target) break;
        now = timer.at;
        timers.delete(timer);
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

test('a healthy SSE stream delivers edits without any REST state or session polling', async () => {
  const h = harness();
  h.streams[0].emit('state', workspace);
  await h.advance(300_000);
  const updated = { projects: [], cards: [{ id: 'new-card' }] };
  h.streams[0].emit('state', updated);
  assert.deepEqual(h.states, [
    { value: workspace, live: true },
    { value: updated, live: true },
  ]);
  assert.equal(h.counts.state, 0);
  assert.equal(h.counts.session, 0);
  assert.equal(h.streams.length, 1);
  h.stop();
});

test('duplicate stream errors schedule one authenticated reconnect and use its SSE snapshot', async () => {
  const h = harness();
  const first = h.streams[0];
  first.emit('state', workspace);
  first.fail();
  first.fail();
  first.fail();
  assert.equal(first.closed, true);
  await h.advance(2_999);
  assert.equal(h.counts.session, 1);
  assert.equal(h.streams.length, 1);
  await h.advance(1);
  assert.equal(h.streams.length, 2);
  assert.equal(h.counts.session, 1);
  h.streams[1].emit('state', workspace);
  assert.equal(h.states.at(-1).live, true);
  assert.equal(h.counts.state, 0);
  h.stop();
});

test('persistent SSE failure backs off and bounds full-state fallback to once a minute', async () => {
  const h = harness({ onOpen: (stream) => stream.fail() });
  await h.advance(12_500);
  assert.equal(h.counts.state, 1);
  assert.equal(h.counts.session, 3);
  assert.equal(h.streams.length, 3);
  assert.equal(h.states[0].live, false);
  await h.advance(112_500);
  assert.equal(h.counts.state, 2);
  assert.equal(h.streams.length, 6);
  h.stop();
});

test('immediately closing streams do not reset backoff just by sending an initial state', async () => {
  const h = harness({
    onOpen(stream) {
      stream.emit('state', workspace);
      stream.fail();
    },
  });
  await h.advance(12_500);
  assert.equal(h.streams.length, 3);
  assert.equal(h.counts.session, 3);
  assert.equal(h.counts.state, 0);
  h.stop();
});

test('a slow REST fallback cannot overwrite a newer SSE state or mark it disconnected', async () => {
  const response = deferred();
  const h = harness({ state: () => response.promise });
  h.streams[0].fail();
  await h.advance(3_000);
  const current = { projects: [{ id: 'latest-project' }], cards: [] };
  h.streams[1].emit('state', current);
  response.resolve(workspace);
  await flush();
  assert.deepEqual(h.states, [{ value: current, live: true }]);
  h.stop();
});

test('hidden tabs keep healthy streams but pause reconnects and REST reads', async () => {
  const h = harness();
  h.streams[0].emit('state', workspace);
  h.availability(false);
  assert.equal(h.streams[0].closed, false);
  await h.advance(120_000);
  assert.equal(h.counts.state, 0);
  assert.equal(h.counts.session, 0);
  // A broken hidden stream gets one security check, but no retry or full state.
  h.streams[0].fail();
  await h.advance(120_000);
  assert.equal(h.counts.session, 1);
  assert.equal(h.streams.length, 1);
  assert.equal(h.counts.state, 0);
  h.availability(true);
  h.availability(true);
  await flush();
  assert.equal(h.counts.session, 2);
  assert.equal(h.streams.length, 2);
  h.streams[1].emit('state', workspace);
  assert.equal(h.states.at(-1).live, true);
  h.stop();
});

test('an expired session stops retries and ignores queued events from the old stream', async () => {
  const h = harness({
    session: async () => {
      throw { status: 401 };
    },
  });
  const first = h.streams[0];
  first.emit('state', workspace);
  first.fail();
  await h.advance(0);
  assert.equal(h.counts.unauthorized, 1);
  await h.advance(120_000);
  h.availability(false);
  h.availability(true);
  first.emit('state', { projects: [{ id: 'revoked' }], cards: [] });
  await flush();
  assert.equal(h.counts.session, 1);
  assert.equal(h.streams.length, 1);
  assert.equal(h.states.length, 1);
  h.stop();
});

test('hidden streams receive permission updates and immediately detect session revocation', async () => {
  const h = harness({
    session: async () => {
      throw { status: 401 };
    },
  });
  h.streams[0].emit('state', workspace);
  h.availability(false);
  h.streams[0].emit('user', { ...user, siteAdmin: false });
  assert.equal(h.users.length, 1);
  h.streams[0].fail();
  await h.advance(0);
  assert.equal(h.counts.unauthorized, 1);
  await h.advance(120_000);
  assert.equal(h.counts.session, 1);
  assert.equal(h.streams.length, 1);
  assert.equal(h.counts.state, 0);
  h.stop();
});

test('session and stream outages remain bounded without duplicate connections', async () => {
  let initial = true;
  const h = harness({
    onOpen(stream) {
      if (initial) {
        stream.emit('state', workspace);
        initial = false;
      }
      stream.fail();
    },
    session: async () => {
      throw new Error('offline');
    },
  });
  await h.advance(12_500);
  assert.equal(h.counts.session, 3);
  assert.equal(h.streams.length, 3);
  assert.equal(h.counts.state, 0);
  h.stop();
});

test('pausing aborts fallback and cleanup suppresses late authentication responses', async () => {
  const fallback = deferred(),
    session = deferred();
  const h = harness({
    state: () => fallback.promise,
    session: () => session.promise,
  });
  h.streams[0].fail();
  const fallbackSignal = h.signals[1];
  h.availability(false);
  assert.equal(fallbackSignal.aborted, true);
  fallback.resolve(workspace);
  h.availability(true);
  const sessionSignal = h.signals[0];
  h.stop();
  assert.equal(sessionSignal.aborted, true);
  session.resolve(user);
  await h.advance(120_000);
  assert.equal(h.states.length, 0);
  assert.equal(h.users.length, 0);
  assert.equal(h.streams.length, 1);
});

test('a connection stable for 30 seconds restores the short retry delay', async () => {
  const h = harness();
  h.streams[0].emit('state', workspace);
  h.streams[0].fail();
  await h.advance(3_000);
  h.streams[1].emit('state', workspace);
  h.streams[1].fail();
  await h.advance(6_000);
  h.streams[2].emit('state', workspace);
  await h.advance(30_000);
  h.streams[2].fail();
  await h.advance(3_000);
  assert.equal(h.streams.length, 4);
  h.stop();
});
