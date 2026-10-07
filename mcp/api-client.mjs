export class BoardError extends Error {
  constructor(message, status, current) {
    super(message);
    this.status = status;
    this.current = current;
  }
}

export function createBoardClient({ url, code, token, name = 'AI 도우미' }) {
  const base = new URL(url);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new Error('DDD_URL에는 HTTP 또는 HTTPS 서버 주소를 지정해 주세요.');
  if (
    token &&
    (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,200}$/.test(token))
  )
    throw new Error('DDD_TOKEN 형식이 올바르지 않습니다.');
  if (
    token &&
    base.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  )
    throw new Error('DDD_TOKEN 연결에는 HTTPS가 필요합니다.');
  if (!code && !token) throw new Error('DDD_TOKEN 또는 개발용 DDD_CODE가 필요합니다.');
  let cookie, signingIn;
  async function login() {
    if (!signingIn)
      signingIn = (async () => {
        const response = await fetch(new URL('/api/session', base), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, code }),
          signal: AbortSignal.timeout(10000),
        });
        const result = await response.json();
        if (!response.ok) throw new BoardError(result.error, response.status);
        const header = response.headers.get('set-cookie');
        if (!header) throw new Error('서버가 세션 쿠키를 반환하지 않았습니다.');
        cookie = header.split(';')[0];
      })().finally(() => {
        signingIn = undefined;
      });
    await signingIn;
  }
  async function request(path, method = 'GET', body, retry = true) {
    if (!token && !cookie) await login();
    const response = await fetch(new URL(`/api${path}`, base), {
      method,
      redirect: 'error',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : { cookie }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 && retry && !token) {
      cookie = undefined;
      await login();
      return request(path, method, body, false);
    }
    const result = await response.json();
    if (!response.ok)
      throw new BoardError(result.error, response.status, result.current);
    return result;
  }
  return { request };
}
