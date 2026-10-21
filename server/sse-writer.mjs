// Preserve complete SSE frames while bounding the bytes queued on the socket.
// Only the frame being sent is serialized; subsequent events keep one lazy
// producer per event type so repeated board changes collapse to the latest state.
export function createSseWriter(
  res,
  { maxBufferBytes, drainTimeoutMs, isLive, disconnect },
) {
  const chunkBytes = Math.min(64 * 1024, maxBufferBytes - 32);
  const pending = new Map();
  let current,
    offset = 0,
    writing = false,
    closed = false,
    timer;

  function close() {
    closed = true;
    clearTimeout(timer);
    current = undefined;
    pending.clear();
  }
  res.once('close', close);
  res.once('error', disconnect);

  function pump() {
    if (closed || writing || res.destroyed) return;
    if (!isLive()) return;
    if (!current) {
      const next = pending.entries().next().value;
      if (!next) return;
      const [name, produce] = next;
      pending.delete(name);
      try {
        const output = produce();
        current = Buffer.isBuffer(output) ? output : Buffer.from(output);
        offset = 0;
      } catch {
        disconnect();
        return;
      }
    }
    const chunk = current.subarray(offset, offset + chunkBytes);
    offset += chunk.length;
    writing = true;
    timer = setTimeout(disconnect, drainTimeoutMs);
    timer.unref();
    // The callback runs after this chunk is flushed. Do not queue another
    // chunk (or interleave a different event) while the transport is blocked.
    res.write(chunk, (error) => {
      clearTimeout(timer);
      writing = false;
      if (closed) return;
      if (error) return disconnect();
      if (offset === current.length) current = undefined;
      pump();
    });
  }

  return {
    close,
    send(name, produce) {
      if (closed || res.destroyed) return;
      // Real data already keeps the connection alive. Heartbeats must not
      // accumulate behind a large state or interrupt its JSON payload.
      if (name === 'heartbeat' && (current || pending.size)) return;
      pending.set(name, produce);
      pump();
    },
  };
}
