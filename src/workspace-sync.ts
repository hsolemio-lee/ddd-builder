import type { User, Workspace } from './types';

type Stream = Pick<EventSource, 'addEventListener' | 'onerror' | 'close'>;
interface Transport {
  open: () => Stream;
  session: (signal: AbortSignal) => Promise<User>;
  state: (signal: AbortSignal) => Promise<Workspace>;
}
interface Handlers {
  user: (user: User) => void;
  state: (state: Workspace, live: boolean) => void;
  presence: (users: User[]) => void;
  disconnected: () => void;
  unauthorized: () => void;
  invalidState: () => void;
}
interface Environment {
  available: () => boolean;
  now: () => number;
  random: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
  watch: (callback: () => void) => () => void;
}
const browser: Environment = {
  available: () => !document.hidden && navigator.onLine,
  now: Date.now,
  random: Math.random,
  schedule(callback, delay) {
    const timer = window.setTimeout(callback, delay);
    return () => window.clearTimeout(timer);
  },
  watch(callback) {
    document.addEventListener('visibilitychange', callback);
    window.addEventListener('online', callback);
    window.addEventListener('offline', callback);
    return () => {
      document.removeEventListener('visibilitychange', callback);
      window.removeEventListener('online', callback);
      window.removeEventListener('offline', callback);
    };
  },
};

// The server sends a complete, permission-filtered state on every SSE connection.
// REST is a bounded read-only fallback, not an additional reconnect snapshot.
export function syncWorkspace(
  transport: Transport,
  handlers: Handlers,
  env: Environment = browser,
): () => void {
  let active = true;
  let terminal = false;
  let epoch = 0;
  let source: Stream | undefined;
  let cancelRetry: (() => void) | undefined;
  let sessionRequest: AbortController | undefined;
  let stateRequest: AbortController | undefined;
  let failures = 0;
  let snapshots = 0;
  let lastSnapshot = -Infinity;
  let lastFallback = -Infinity;
  const available = () => active && !terminal && env.available();

  function closeStream() {
    const previous = source;
    source = undefined;
    previous?.close();
  }
  function pause() {
    epoch++;
    cancelRetry?.();
    cancelRetry = undefined;
    closeStream();
    sessionRequest?.abort();
    stateRequest?.abort();
    sessionRequest = stateRequest = undefined;
    handlers.disconnected();
  }
  function unauthorized(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 401
    ) {
      terminal = true;
      pause();
      handlers.unauthorized();
      return true;
    }
    return false;
  }
  function scheduleRetry() {
    if (!available() || cancelRetry || sessionRequest) return;
    const delay = Math.min(
      60_000,
      3_000 * 2 ** Math.min(failures++, 5) * (1 + env.random() * 0.2),
    );
    cancelRetry = env.schedule(() => {
      cancelRetry = undefined;
      connect();
    }, delay);
  }
  async function fallback() {
    const now = env.now();
    if (
      !available() ||
      stateRequest ||
      now - Math.max(lastSnapshot, lastFallback) < 60_000
    )
      return;
    lastFallback = now;
    const request = new AbortController();
    stateRequest = request;
    const started = epoch;
    const received = snapshots;
    try {
      const state = await transport.state(request.signal);
      if (
        available() &&
        !request.signal.aborted &&
        started === epoch &&
        received === snapshots
      ) {
        lastSnapshot = env.now();
        handlers.state(state, false);
      }
    } catch (error) {
      if (available() && !request.signal.aborted && started === epoch)
        unauthorized(error);
    } finally {
      if (stateRequest === request) stateRequest = undefined;
    }
  }
  function connect() {
    if (!available() || source) return;
    const stream = transport.open();
    source = stream;
    let firstStateAt: number | undefined;
    const current = () => active && !terminal && source === stream;
    stream.addEventListener('state', (event) => {
      if (!current()) return;
      try {
        const state = JSON.parse((event as MessageEvent).data) as Workspace;
        snapshots++;
        lastSnapshot = env.now();
        firstStateAt ??= lastSnapshot;
        handlers.state(state, true);
      } catch {
        handlers.invalidState();
      }
    });
    stream.addEventListener('user', (event) => {
      if (!current()) return;
      try {
        handlers.user(JSON.parse((event as MessageEvent).data) as User);
      } catch {
        // The next authenticated reconnect refreshes the user.
      }
    });
    stream.addEventListener('presence', (event) => {
      if (!current()) return;
      try {
        handlers.presence(JSON.parse((event as MessageEvent).data) as User[]);
      } catch {
        // The next presence event refreshes the list.
      }
    });
    stream.onerror = () => {
      if (!current()) return;
      // Stop EventSource's automatic retry before scheduling our bounded retry.
      closeStream();
      handlers.disconnected();
      if (firstStateAt !== undefined && env.now() - firstStateAt >= 30_000)
        failures = 0;
      // Validate revocation immediately, including for a hidden tab. The next
      // stream connection still waits for backoff and a visible, online tab.
      void reconnect(false);
      void fallback();
    };
  }
  async function reconnect(immediately = true) {
    if (
      !active ||
      terminal ||
      source ||
      sessionRequest ||
      (immediately && !env.available())
    )
      return;
    const request = new AbortController();
    sessionRequest = request;
    const started = epoch;
    try {
      const user = await transport.session(request.signal);
      if (active && !terminal && started === epoch) {
        handlers.user(user);
        if (immediately) connect();
      }
    } catch (error) {
      if (active && !terminal && started === epoch) unauthorized(error);
    } finally {
      if (sessionRequest === request) sessionRequest = undefined;
      if (active && started === epoch && !source) scheduleRetry();
    }
  }
  const unwatch = env.watch(() => {
    if (!env.available()) {
      cancelRetry?.();
      cancelRetry = undefined;
      stateRequest?.abort();
      stateRequest = undefined;
      // Keep a healthy stream for permission changes and revocation notices.
      // Only new connections and fallback reads pause in the background.
    } else if (!source && !cancelRetry) void reconnect();
  });
  connect();
  return () => {
    active = false;
    unwatch();
    pause();
  };
}
