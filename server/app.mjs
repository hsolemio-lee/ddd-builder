import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { openStore, record, seedSample } from './store.mjs';
import {
  securityOptions,
  FixedWindowLimiter,
  transportSecurity,
  rejectRateLimit,
} from './security.mjs';

const kinds = {
  discovery: ['problem', 'actor', 'term'],
  events: ['event', 'command', 'actor', 'policy', 'question'],
  contexts: ['context'],
  aggregates: ['aggregate'],
  tasks: ['task'],
};
const limits = { name: 120, title: 200, description: 20000, detail: 20000 };
const comparePosition = (a, b) =>
  a.position - b.position || a.id.localeCompare(b.id);
function fail(status, error, current) {
  throw Object.assign(new Error(error), {
    status,
    ...(current ? { current } : {}),
  });
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value, name, max, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(400, `${name} 형식이 올바르지 않습니다.`);
  return required ? value.trim() : value;
}
function allowed(value, fields) {
  if (!object(value) || Object.keys(value).some((key) => !fields.includes(key)))
    fail(400, '허용되지 않은 필드가 있습니다.');
}
function revision(body, current) {
  if (!Number.isSafeInteger(body.revision) || body.revision < 1)
    fail(400, '현재 버전 번호가 필요합니다.');
  if (body.revision !== current.revision)
    fail(
      409,
      '다른 참여자가 변경했습니다. 최신 내용을 확인해 주세요.',
      current,
    );
}
function changed(current, fields, user) {
  return {
    ...current,
    ...fields,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: user.name,
  };
}
function cardFields(body, projectId, store, current) {
  allowed(
    body,
    current
      ? [
          'kind',
          'title',
          'description',
          'contextId',
          'data',
          'position',
          'revision',
        ]
      : [
          'stage',
          'kind',
          'title',
          'description',
          'contextId',
          'data',
          'position',
        ],
  );
  const value = {
    stage: current?.stage,
    kind: current?.kind,
    title: current?.title,
    description: current?.description ?? '',
    contextId: current?.contextId ?? null,
    data: current?.data ?? {},
    position: current?.position ?? 0,
    ...body,
  };
  if (!kinds[value.stage]?.includes(value.kind))
    fail(400, '단계와 카드 종류가 올바르지 않습니다.');
  value.title = text(value.title, '제목', limits.title, true);
  value.description = text(value.description, '설명', limits.description);
  if (value.contextId !== null) {
    if (typeof value.contextId !== 'string')
      fail(400, '컨텍스트 참조가 올바르지 않습니다.');
    const context = store.card(value.contextId);
    if (
      !context ||
      context.projectId !== projectId ||
      context.stage !== 'contexts'
    )
      fail(400, '같은 프로젝트의 컨텍스트를 선택해 주세요.');
  }
  if (!Number.isFinite(value.position) || Math.abs(value.position) > 1000000)
    fail(400, '카드 위치가 올바르지 않습니다.');
  const defaults =
    value.kind === 'context'
      ? { relationships: '' }
      : value.kind === 'aggregate'
        ? { root: '', entities: '', valueObjects: '', invariants: '' }
        : value.kind === 'task'
          ? { assignee: '', done: false }
          : {};
  allowed(value.data, Object.keys(defaults));
  value.data = { ...defaults, ...value.data };
  for (const [key, field] of Object.entries(value.data)) {
    if (key === 'done') {
      if (typeof field !== 'boolean')
        fail(400, '완료 여부는 참 또는 거짓이어야 합니다.');
    } else text(field, key, limits.detail);
  }
  delete value.revision;
  return value;
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) fail(400, '요청 내용이 너무 큽니다.');
    chunks.push(chunk);
  }
  try {
    const value = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
      : {};
    if (!object(value)) fail(400, 'JSON 객체가 필요합니다.');
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(400, 'JSON 요청 형식이 올바르지 않습니다.');
  }
}
function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(value));
}
export function shareUrls(
  host,
  port,
  requestHost,
  { publicUrl, containerized = false, requestProtocol = 'http' } = {},
) {
  const urls = new Set();
  if (publicUrl) urls.add(new URL(publicUrl).origin);
  if (requestHost) urls.add(`${requestProtocol}://${requestHost}`);
  if (containerized && urls.size) return [...urls];
  const wildcard = host === '0.0.0.0' || host === '::';
  const displayHost = wildcard ? 'localhost' : host;
  urls.add(
    `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}`,
  );
  if (wildcard)
    for (const entries of Object.values(networkInterfaces()))
      for (const entry of entries || [])
        if (!entry.internal && entry.family === 'IPv4')
          urls.add(`http://${entry.address}:${port}`);
  return [...urls];
}
function markdown(project, cards) {
  const escape = (value) =>
    String(value).replace(/[\\`*_{}\[\]<>#!|]/g, '\\$&');
  const sections = [
    `# ${escape(project.name)}`,
    '',
    escape(project.description),
  ];
  const names = {
    discovery: '문제 탐색',
    events: '이벤트 스토밍',
    contexts: '바운디드 컨텍스트',
    aggregates: '애그리게이트',
    tasks: '실행 과제',
  };
  for (const stage of Object.keys(kinds)) {
    sections.push('', `## ${names[stage]}`);
    for (const card of cards
      .filter((c) => c.stage === stage)
      .sort(comparePosition)) {
      sections.push(
        '',
        `### ${escape(card.title)} (${card.kind})`,
        '',
        escape(card.description),
      );
      if (card.contextId)
        sections.push(
          '',
          `컨텍스트: ${escape(cards.find((c) => c.id === card.contextId)?.title ?? '')}`,
        );
      for (const [key, value] of Object.entries(card.data))
        sections.push('', `${key}: ${escape(value)}`);
    }
  }
  return sections.join('\n') + '\n';
}

export async function createApp({
  dataDir,
  code,
  staticDir,
  host = '127.0.0.1',
  port = 0,
  publicUrl,
  mcpContainerName,
  security,
}) {
  const safeguards = securityOptions(security);
  if (!dataDir || typeof code !== 'string' || !code)
    throw new Error('dataDir 및 code가 필요합니다.');
  if (publicUrl) {
    let url;
    try {
      url = new URL(publicUrl);
    } catch {
      throw new Error('PUBLIC_URL에는 HTTP 또는 HTTPS 주소를 지정해 주세요.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        'PUBLIC_URL에는 인증 정보가 없는 HTTP 또는 HTTPS 주소를 지정해 주세요.',
      );
  }
  if (
    mcpContainerName &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(mcpContainerName)
  )
    throw new Error('MCP_CONTAINER_NAME이 올바르지 않습니다.');
  const publicAddress = publicUrl ? new URL(publicUrl) : undefined;
  const apiLimiter = new FixedWindowLimiter(safeguards.apiRate),
    loginLimiter = new FixedWindowLimiter(safeguards.loginRate),
    writeLimiter = new FixedWindowLimiter(safeguards.writeRate);
  const store = openStore(dataDir),
    sessions = new Map(),
    clients = new Set();
  let closing;
  const session = (req) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('ddd_session='))
      ?.slice(12);
    const item = sessions.get(token);
    if (item && item.expiresAt > Date.now()) return { ...item, token };
    if (item) clearSession(token);
    return null;
  };
  const emit = (client, name, value) =>
    client.res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
  function presence() {
    const unique = new Map();
    for (const c of clients)
      if (sessions.has(c.token)) unique.set(c.user.id, c.user);
    const people = [...unique.values()];
    for (const client of clients) emit(client, 'presence', people);
  }
  function broadcast() {
    const state = store.state();
    for (const client of clients) emit(client, 'state', state);
  }
  function clearSession(token) {
    sessions.delete(token);
    writeLimiter.delete(token);
    for (const client of clients)
      if (client.token === token) {
        clients.delete(client);
        client.res.end();
      }
    presence();
  }
  function pruneSessions() {
    for (const [token, value] of sessions)
      if (value.expiresAt <= Date.now()) clearSession(token);
  }
  const server = createServer(async (req, res) => {
    const { secureRequest, requestOrigin } = transportSecurity(
      req,
      res,
      publicAddress,
    );
    try {
      const url = new URL(req.url, 'http://localhost'),
        path = url.pathname,
        method = req.method;
      const secureCookie = secureRequest ? '; Secure' : '';
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method) || !staticDir)
          fail(404, '파일을 찾을 수 없습니다.');
        let decoded;
        try {
          decoded = decodeURIComponent(path);
        } catch {
          fail(404, '파일을 찾을 수 없습니다.');
        }
        if (decoded.includes('\0') || decoded.split(/[\\/]/).includes('..'))
          fail(404, '파일을 찾을 수 없습니다.');
        let root;
        try {
          root = await realpath(staticDir);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(
            '화면 빌드가 필요합니다. 프로젝트에서 npm run build를 실행한 뒤 다시 열어 주세요.',
          );
          return;
        }
        let file;
        try {
          file = await realpath(
            resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`),
          );
          if (!file.startsWith(root + sep) || !(await stat(file)).isFile())
            fail(404, '파일을 찾을 수 없습니다.');
        } catch {
          fail(404, '파일을 찾을 수 없습니다.');
        }
        const mime = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
          '.json': 'application/json',
        };
        res.writeHead(200, {
          'content-type': mime[extname(file)] || 'application/octet-stream',
          'cache-control': 'no-cache',
        });
        res.end(method === 'HEAD' ? undefined : await readFile(file));
        return;
      }
      const peer = req.socket.remoteAddress || 'unknown';
      const apiRetry = apiLimiter.consume(peer);
      if (apiRetry) rejectRateLimit(apiRetry);
      pruneSessions();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && req.headers.origin) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {
          fail(403, '다른 사이트의 변경 요청은 허용하지 않습니다.');
        }
        if (
          origin.origin !== req.headers.origin ||
          (origin.origin !== requestOrigin &&
            origin.origin !== publicAddress?.origin)
        )
          fail(403, '다른 사이트의 변경 요청은 허용하지 않습니다.');
      }
      const signed = session(req);
      if (
        signed &&
        !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
        !(path === '/api/session' && method === 'POST')
      ) {
        const writeRetry = writeLimiter.consume(signed.token);
        if (writeRetry) rejectRateLimit(writeRetry);
      }
      if (path === '/api/session') {
        if (method === 'POST') {
          const loginRetry = loginLimiter.consume(peer);
          if (loginRetry) rejectRateLimit(loginRetry);
          const value = await body(req);
          allowed(value, ['name', 'code']);
          const name = text(value.name, '이름', 60, true);
          const supplied = Buffer.from(
              typeof value.code === 'string' ? value.code : '',
            ),
            expected = Buffer.from(code);
          if (
            supplied.length !== expected.length ||
            !timingSafeEqual(supplied, expected)
          )
            fail(401, '접속 코드가 올바르지 않습니다.');
          pruneSessions();
          if (
            sessions.size >= safeguards.maxSessions &&
            !sessions.has(signed?.token)
          )
            rejectRateLimit();
          if (signed) clearSession(signed.token);
          const token = randomBytes(32).toString('hex'),
            user = { id: randomUUID(), name };
          sessions.set(token, {
            user,
            expiresAt: Date.now() + safeguards.sessionLifetimeMs,
          });
          json(
            res,
            200,
            { user },
            {
              'set-cookie': `ddd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(1, Math.floor(safeguards.sessionLifetimeMs / 1000))}${secureCookie}`,
            },
          );
          return;
        }
        if (!signed) fail(401, '먼저 접속해 주세요.');
        if (method === 'GET') {
          json(res, 200, { user: signed.user });
          return;
        }
        if (method === 'DELETE') {
          clearSession(signed.token);
          json(
            res,
            200,
            { ok: true },
            {
              'set-cookie': `ddd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`,
            },
          );
          return;
        }
      }
      if (!signed) fail(401, '먼저 접속해 주세요.');
      const user = signed.user;
      if (path === '/api/state' && method === 'GET') {
        json(res, 200, store.state());
        return;
      }
      if (path === '/api/info' && method === 'GET') {
        json(res, 200, {
          urls: shareUrls(
            host,
            server.address().port,
            secureRequest ? publicAddress.host : req.headers.host,
            {
              publicUrl,
              containerized: Boolean(mcpContainerName),
              requestProtocol: secureRequest ? 'https' : 'http',
            },
          ),
          runtime: mcpContainerName ? 'docker' : 'local',
          mcp: {
            command: mcpContainerName ? 'docker' : process.execPath,
            args: [
              ...(mcpContainerName
                ? [
                    'exec',
                    '-i',
                    '-e',
                    'DDD_URL',
                    '-e',
                    'DDD_CODE',
                    '-e',
                    'DDD_READ_ONLY',
                    '-e',
                    'DDD_AI_NAME',
                    mcpContainerName,
                    process.execPath,
                  ]
                : []),
              resolve(import.meta.dirname, '../mcp/index.mjs'),
            ],
            env: {
              DDD_URL: `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host}:${server.address().port}`,
              DDD_CODE: code,
              DDD_AI_NAME: 'AI 도우미',
            },
          },
        });
        return;
      }
      if (path === '/api/events' && method === 'GET') {
        const sessionStreams = [...clients].filter(
          (client) => client.token === signed.token,
        ).length;
        if (
          clients.size >= safeguards.maxSseClients ||
          sessionStreams >= safeguards.maxSsePerSession
        )
          rejectRateLimit();
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.flushHeaders();
        const client = { res, user, token: signed.token };
        clients.add(client);
        emit(client, 'state', store.state());
        presence();
        res.on('close', () => {
          if (clients.delete(client)) presence();
        });
        return;
      }
      if (path === '/api/projects' && method === 'POST') {
        const value = await body(req);
        allowed(value, ['name', 'description', 'sample']);
        const name = text(value.name, '프로젝트 이름', limits.name, true),
          description = text(
            value.description === undefined ? '' : value.description,
            '설명',
            limits.description,
          );
        if (value.sample !== undefined && typeof value.sample !== 'boolean')
          fail(400, '예제 여부가 올바르지 않습니다.');
        const project = value.sample
          ? store.transaction(() =>
              seedSample(store, user.name, name, description),
            )
          : record({ name, description }, user.name);
        if (!value.sample) store.saveProject(project);
        broadcast();
        json(res, 201, project);
        return;
      }
      let match;
      if (
        (match = path.match(/^\/api\/projects\/([^/]+)\/export$/)) &&
        method === 'GET'
      ) {
        const project = store.project(match[1]);
        if (!project) fail(404, '프로젝트를 찾을 수 없습니다.');
        const format = url.searchParams.get('format') || 'json';
        if (!['json', 'markdown'].includes(format))
          fail(400, '내보내기 형식이 올바르지 않습니다.');
        const cards = store
          .state()
          .cards.filter((c) => c.projectId === project.id);
        const filename = `ddd-project-${project.id}.${format === 'json' ? 'json' : 'md'}`;
        res.writeHead(200, {
          'content-type':
            format === 'json'
              ? 'application/json; charset=utf-8'
              : 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'no-store',
        });
        res.end(
          format === 'json'
            ? JSON.stringify({ project, cards }, null, 2)
            : markdown(project, cards),
        );
        return;
      }
      if (
        (match = path.match(/^\/api\/projects\/([^/]+)\/cards$/)) &&
        method === 'POST'
      ) {
        const value = await body(req);
        if (!store.project(match[1])) fail(404, '프로젝트를 찾을 수 없습니다.');
        const fields = cardFields(value, match[1], store);
        const card = record({ projectId: match[1], ...fields }, user.name);
        store.saveCard(card);
        broadcast();
        json(res, 201, card);
        return;
      }
      if (
        (match = path.match(/^\/api\/projects\/([^/]+)$/)) &&
        ['PATCH', 'DELETE'].includes(method)
      ) {
        const value = await body(req);
        const current = store.project(match[1]);
        if (!current) fail(404, '프로젝트를 찾을 수 없습니다.');
        allowed(
          value,
          method === 'PATCH'
            ? ['name', 'description', 'revision']
            : ['revision'],
        );
        revision(value, current);
        if (method === 'DELETE') {
          store.deleteProject(current.id);
          broadcast();
          json(res, 200, { ok: true });
          return;
        }
        const project = changed(
          current,
          {
            name: text(
              value.name === undefined ? current.name : value.name,
              '프로젝트 이름',
              limits.name,
              true,
            ),
            description: text(
              value.description === undefined
                ? current.description
                : value.description,
              '설명',
              limits.description,
            ),
          },
          user,
        );
        store.saveProject(project);
        broadcast();
        json(res, 200, project);
        return;
      }
      if (
        (match = path.match(/^\/api\/cards\/([^/]+)\/move$/)) &&
        method === 'POST'
      ) {
        const value = await body(req);
        allowed(value, ['revision', 'direction']);
        const current = store.card(match[1]);
        if (!current) fail(404, '카드를 찾을 수 없습니다.');
        revision(value, current);
        if (value.direction !== -1 && value.direction !== 1)
          fail(400, '이동 방향은 -1 또는 1이어야 합니다.');
        const siblings = store
          .state()
          .cards.filter(
            (card) =>
              card.projectId === current.projectId &&
              card.stage === current.stage &&
              card.kind === current.kind,
          )
          .sort(comparePosition);
        const index = siblings.findIndex((card) => card.id === current.id),
          neighbor = index + value.direction;
        if (neighbor < 0 || neighbor >= siblings.length) {
          json(res, 200, { cards: siblings });
          return;
        }
        [siblings[index], siblings[neighbor]] = [
          siblings[neighbor],
          siblings[index],
        ];
        const cards = store.transaction(() =>
          siblings.map((card, position) => {
            if (card.position === position) return card;
            const moved = changed(card, { position }, user);
            store.saveCard(moved);
            return moved;
          }),
        );
        broadcast();
        json(res, 200, { cards });
        return;
      }
      if (
        (match = path.match(/^\/api\/cards\/([^/]+)$/)) &&
        ['PATCH', 'DELETE'].includes(method)
      ) {
        const value = await body(req);
        const current = store.card(match[1]);
        if (!current) fail(404, '카드를 찾을 수 없습니다.');
        if (method === 'DELETE') {
          allowed(value, ['revision']);
          revision(value, current);
          store.transaction(() => {
            if (current.stage === 'contexts')
              for (const card of store
                .state()
                .cards.filter((c) => c.contextId === current.id))
                store.saveCard(changed(card, { contextId: null }, user));
            store.deleteCard(current.id);
          });
          broadcast();
          json(res, 200, { ok: true });
          return;
        }
        allowed(value, [
          'kind',
          'title',
          'description',
          'contextId',
          'data',
          'position',
          'revision',
        ]);
        revision(value, current);
        const fields = cardFields(value, current.projectId, store, current);
        const card = changed(current, fields, user);
        store.saveCard(card);
        broadcast();
        json(res, 200, card);
        return;
      }
      fail(404, '요청한 항목을 찾을 수 없습니다.');
    } catch (error) {
      if (!res.headersSent) {
        if (!error.status) console.error(error);
        json(
          res,
          error.status || 500,
          {
            error: error.status
              ? error.message
              : '서버에서 오류가 발생했습니다.',
            ...(error.current ? { current: error.current } : {}),
          },
          error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {},
        );
      } else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const heartbeat = setInterval(() => {
    pruneSessions();
    apiLimiter.prune();
    loginLimiter.prune();
    writeLimiter.prune();
    for (const client of clients) client.res.write(': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    clearInterval(heartbeat);
    store.close();
    throw error;
  }
  return {
    server,
    close() {
      if (closing) return closing;
      clearInterval(heartbeat);
      for (const client of clients) client.res.end();
      clients.clear();
      sessions.clear();
      closing = new Promise((resolve, reject) => {
        server.close((error) => {
          store.close();
          error ? reject(error) : resolve();
        });
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
