const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const plainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

const defaults = {
  apiRate: { limit: 1200, windowMs: 60000, maxKeys: 4096 },
  loginRate: { limit: 30, windowMs: 60000, maxKeys: 4096 },
  writeRate: { limit: 300, windowMs: 60000, maxKeys: 4096 },
  maxSessions: 200,
  sessionLifetimeMs: 12 * 60 * 60 * 1000,
  maxSseClients: 200,
  maxSsePerSession: 5,
  maxSseBufferBytes: 1024 * 1024,
};

export function securityOptions(options = {}) {
  if (
    !plainObject(options) ||
    Object.keys(options).some((key) => !Object.hasOwn(defaults, key))
  )
    throw new Error('security options are invalid.');
  const result = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    if (plainObject(fallback)) {
      const supplied = options[name] === undefined ? {} : options[name];
      if (
        !plainObject(supplied) ||
        Object.keys(supplied).some((key) => !Object.hasOwn(fallback, key))
      )
        throw new Error(`security.${name} is invalid.`);
      result[name] = { ...fallback, ...supplied };
      if (Object.values(result[name]).some((value) => !positiveInteger(value)))
        throw new Error(
          `security.${name} values must be positive safe integers.`,
        );
    } else {
      result[name] = options[name] === undefined ? fallback : options[name];
      if (!positiveInteger(result[name]))
        throw new Error(`security.${name} must be a positive safe integer.`);
    }
  }
  return result;
}

// Saturation refuses new keys instead of evicting live counters. A spoofed or
// rotating peer therefore cannot erase another peer's rate limit.
export class FixedWindowLimiter {
  #entries = new Map();
  constructor({ limit, windowMs, maxKeys }) {
    if (![limit, windowMs, maxKeys].every(positiveInteger))
      throw new Error('security rate values must be positive safe integers.');
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }
  prune(now = Date.now()) {
    for (const [key, entry] of this.#entries)
      if (entry.expiresAt <= now) this.#entries.delete(key);
  }
  consume(key, now = Date.now()) {
    this.prune(now);
    let entry = this.#entries.get(key);
    if (!entry) {
      if (this.#entries.size >= this.maxKeys) {
        const expiry = Math.min(
          ...[...this.#entries.values()].map((value) => value.expiresAt),
        );
        return Math.max(1, Math.ceil((expiry - now) / 1000));
      }
      entry = { count: 0, expiresAt: now + this.windowMs };
      this.#entries.set(key, entry);
    }
    if (entry.count >= this.limit)
      return Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
    entry.count++;
    return 0;
  }
  delete(key) {
    this.#entries.delete(key);
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "connect-src 'self'",
].join('; ');

export function transportSecurity(req, res, publicAddress) {
  const canonicalHost =
    publicAddress?.protocol === 'https:' &&
    req.headers.host === publicAddress.host;
  const canonicalOrigin =
    publicAddress?.protocol === 'https:' &&
    req.headers.origin === publicAddress.origin;
  const secureRequest = Boolean(canonicalHost || canonicalOrigin);
  const requestOrigin = canonicalHost
    ? publicAddress.origin
    : `http://${req.headers.host}`;
  res.setHeader('content-security-policy', contentSecurityPolicy);
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  // PUBLIC_URL is the explicit transport contract for the HTTPS terminator.
  // Forwarded headers and an Origin header alone cannot enable HSTS.
  const loopback =
    publicAddress &&
    /^(localhost|127(?:\.\d+){3}|\[::1\])$/i.test(publicAddress.hostname);
  if (canonicalHost && !loopback && (!req.headers.origin || canonicalOrigin))
    res.setHeader('strict-transport-security', 'max-age=31536000');
  return { secureRequest, requestOrigin };
}

export function rejectRateLimit(retryAfter = 1) {
  throw Object.assign(
    new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
    {
      status: 429,
      retryAfter,
    },
  );
}
