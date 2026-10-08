import { createServer } from 'node:http';
import { handleMcpHttp } from '../mcp/http.mjs';
import {
  statuses,
  scenarios,
  linkKinds,
  flowAllowed,
  reviewBoard,
} from '../shared/design.mjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { openStore, record, seedSample } from './store.mjs';
import { createIdentity, validateAuthConfig } from './identity.mjs';
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
          'status',
          'decision',
          'scenario',
          'links',
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
          'status',
          'decision',
          'scenario',
          'links',
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
    status: current?.status ?? 'proposed',
    decision: current?.decision ?? '',
    scenario: current?.scenario ?? 'shared',
    links: current?.links ?? [],
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
      ? {
          relationships: '',
          relationshipDiagram: '',
          relationshipFormat: 'text',
        }
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
  if (
    value.kind === 'context' &&
    !['text', 'mermaid'].includes(value.data.relationshipFormat)
  )
    fail(400, '컨텍스트 관계 형식은 text 또는 mermaid여야 합니다.');
  if (
    !Object.hasOwn(statuses, value.status) ||
    !Object.hasOwn(scenarios, value.scenario)
  )
    fail(400, '합의 상태 또는 흐름 구분이 올바르지 않습니다.');
  value.decision = text(value.decision, '검토 근거', limits.detail);
  if (!Array.isArray(value.links) || value.links.length > 100)
    fail(400, '연결은 최대 100개까지 지정할 수 있습니다.');
  const seen = new Set();
  for (const link of value.links) {
    allowed(link, ['targetId', 'kind']);
    if (
      typeof link.targetId !== 'string' ||
      !Object.hasOwn(linkKinds, link.kind)
    )
      fail(400, '연결 형식이 올바르지 않습니다.');
    const target = store.card(link.targetId);
    if (!target || target.projectId !== projectId || target.id === current?.id)
      fail(400, '같은 프로젝트의 다른 카드에 연결해 주세요.');
    const key = link.kind + ':' + link.targetId;
    if (seen.has(key)) fail(400, '같은 연결을 중복 지정할 수 없습니다.');
    seen.add(key);
    if (link.kind === 'flow' && !flowAllowed(value, target))
      fail(
        400,
        '흐름은 행위자 → 명령 → 이벤트 → 정책 → 명령 또는 이벤트 → 이벤트로 연결해 주세요.',
      );
  }
  if (current && current.kind !== value.kind) {
    for (const source of store
      .state()
      .cards.filter((c) => c.projectId === projectId))
      if (
        source.links.some(
          (l) => l.kind === 'flow' && l.targetId === current.id,
        ) &&
        !flowAllowed(source, value)
      )
        fail(
          400,
          '카드 유형을 바꾸기 전에 들어오는 흐름 연결을 수정해 주세요.',
        );
  }
  if (
    current?.status === 'agreed' &&
    body.status === undefined &&
    [
      'kind',
      'title',
      'description',
      'contextId',
      'data',
      'scenario',
      'links',
    ].some((key) => JSON.stringify(value[key]) !== JSON.stringify(current[key]))
  )
    value.status = 'proposed';
  if (value.status === 'agreed' && !value.decision.trim())
    fail(400, '합의할 때 검토자와 합의 근거를 기록해 주세요.');
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
      sections.push(
        '',
        `검토 상태: ${statuses[card.status]}`,
        `흐름 구분: ${scenarios[card.scenario]}`,
      );
      if (card.decision)
        sections.push('', `검토 근거: ${escape(card.decision)}`);
      for (const link of card.links)
        sections.push(
          '',
          `${linkKinds[link.kind]} → ${escape(cards.find((c) => c.id === link.targetId)?.title ?? link.targetId)} (${escape(link.targetId)})`,
        );
      if (card.contextId)
        sections.push(
          '',
          `컨텍스트: ${escape(cards.find((c) => c.id === card.contextId)?.title ?? '')}`,
        );
      for (const [key, value] of Object.entries(card.data)) {
        if (key === 'relationshipDiagram' && value) {
          const fence = '`'.repeat(
            Math.max(
              3,
              ...[...String(value).matchAll(/`+/g)].map((m) => m[0].length + 1),
            ),
          );
          sections.push(
            '',
            '컨텍스트 관계:',
            fence + 'mermaid',
            String(value),
            fence,
          );
        } else sections.push('', `${key}: ${escape(value)}`);
      }
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
  auth = { mode: 'legacy' },
  serviceMode = 'workshop',
}) {
  const safeguards = securityOptions(security);
  validateAuthConfig(auth, serviceMode, publicUrl);
  if (
    !dataDir ||
    (auth.mode === 'legacy' && (typeof code !== 'string' || !code))
  )
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
  let closing, identity;
  const session = (req) => {
    if (identity) return identity.session(req);
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
  const frame = (name, value) =>
    `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
  function disconnect(client) {
    client.closing = true;
    // Destroy queued bytes and the socket; end() can leave a paused peer alive.
    // The close handler releases capacity only after the response closes.
    client.res.destroy();
  }
  function send(client, output) {
    if (client.closing || client.res.destroyed) return;
    // Reserve chunk framing bytes as well as the application's event payload.
    if (
      client.res.writableLength + Buffer.byteLength(output) + 32 >
      safeguards.maxSseBufferBytes
    ) {
      disconnect(client);
      return;
    }
    client.res.write(output);
  }
  const emit = (client, name, value) => send(client, frame(name, value));
  function live(client) {
    if (!identity) return sessions.has(client.token) && !client.closing;
    const current = identity.credential(client.token, false, false);
    if (!current) {
      disconnect(client);
      return false;
    }
    client.user = current.user;
    client.signed = current;
    return !client.closing;
  }
  function presence() {
    const active = [...clients].filter(live);
    for (const viewer of active) {
      const ids = identity
        ? new Set(identity.state(viewer.signed).projects.map((p) => p.id))
        : null;
      const unique = new Map();
      for (const other of active) {
        if (
          !identity ||
          other.user.id === viewer.user.id ||
          identity.state(other.signed).projects.some((p) => ids.has(p.id))
        )
          unique.set(other.user.id, {
            id: other.user.id,
            name: other.user.name,
          });
      }
      emit(viewer, 'presence', [...unique.values()]);
    }
  }
  function broadcast() {
    const output = identity ? null : frame('state', store.state());
    for (const client of clients) {
      if (!live(client)) continue;
      if (identity) emit(client, 'user', client.user);
      send(client, output || frame('state', identity.state(client.signed)));
    }
  }
  function clearSession(token) {
    sessions.delete(token);
    writeLimiter.delete(token);
    for (const client of clients)
      if (client.token === token) disconnect(client);
    presence();
  }
  function pruneSessions() {
    if (identity) {
      identity.prune();
      for (const client of clients) live(client);
    }
    for (const [token, value] of sessions)
      if (value.expiresAt <= Date.now()) clearSession(token);
  }
  if (auth.mode === 'oidc') {
    try {
      identity = await createIdentity({
        store,
        auth,
        publicUrl,
        safeguards,
        onChange(targetId) {
          if (targetId)
            for (const c of clients) if (c.user.id === targetId) disconnect(c);
          broadcast();
          presence();
        },
      });
    } catch (error) {
      store.close();
      throw error;
    }
  }
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    let auditSigned;

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
      if (!path.startsWith('/api/') && path !== '/mcp') {
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
      pruneSessions();
      let validOrigin = true;
      if (
        (path === '/mcp' || !['GET', 'HEAD', 'OPTIONS'].includes(method)) &&
        req.headers.origin
      ) {
        try {
          const origin = new URL(req.headers.origin);
          validOrigin =
            origin.origin === req.headers.origin &&
            (path === '/mcp'
              ? origin.origin ===
                (publicAddress?.origin ||
                  `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`)
              : origin.origin === requestOrigin ||
                origin.origin === publicAddress?.origin);
        } catch {
          validOrigin = false;
        }
      }
      const signed = session(req);
      auditSigned = signed;
      const loggingOut =
        signed && validOrigin && path === '/api/session' && method === 'DELETE';
      // Revocation must remain available when quotas are exhausted. Only an
      // authenticated logout with an allowed origin receives this exemption.
      const apiRetry = loggingOut ? 0 : apiLimiter.consume(peer);
      if (apiRetry) rejectRateLimit(apiRetry);
      if (!validOrigin)
        fail(403, '다른 사이트의 변경 요청은 허용하지 않습니다.');
      if (
        signed &&
        !loggingOut &&
        !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
        !(path === '/api/session' && method === 'POST')
      ) {
        const writeRetry = writeLimiter.consume(signed.token);
        if (writeRetry) rejectRateLimit(writeRetry);
      }
      if (path === '/mcp') {
        if (!identity)
          fail(404, 'HTTP MCP는 개인 토큰 인증 모드에서 사용할 수 있습니다.');
        if (!signed?.bearer) fail(401, '개인 MCP Bearer 토큰이 필요합니다.');
        identity.project(signed, signed.projectId, 'viewer');
        if (method !== 'POST') {
          res.setHeader('allow', 'POST');
          fail(405, 'HTTP MCP는 POST 요청을 사용합니다.');
        }
        if (
          req.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
          'application/json'
        )
          fail(415, 'application/json 요청이 필요합니다.');
        const payload = await body(req);
        // Recheck after reading the body: the credential may have been revoked.
        identity.project(signed, signed.projectId, 'viewer');
        const address = server.address();
        const localHost =
          host === '0.0.0.0'
            ? '127.0.0.1'
            : host === '::'
              ? '[::1]'
              : host.includes(':')
                ? `[${host}]`
                : host;
        await handleMcpHttp(req, res, payload, {
          url: `http://${localHost}:${address.port}`,
          token: signed.token,
          readOnly: signed.scope !== 'write',
        });
        return;
      }
      if (path === '/api/auth/config' && method === 'GET') {
        json(res, 200, {
          mode: auth.mode,
          ...(identity ? { loginUrl: '/api/auth/login' } : {}),
        });
        return;
      }
      if (identity) {
        if (path === '/api/auth/login' || path === '/api/auth/callback') {
          const retry = loginLimiter.consume(peer);
          if (retry) rejectRateLimit(retry);
        }
        if (
          await identity.routes({
            path,
            method,
            req,
            res,
            signed,
            requestId,
            body,
            json,
          })
        )
          return;
      }
      if (!identity && path === '/api/session') {
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
      const authorize = (projectId, minimum = 'viewer', human = false) => {
        if (!identity) return;
        if (human) identity.human(signed);
        identity.project(signed, projectId, minimum);
      };
      const auditChange = (event, projectId, targetId) =>
        identity?.audit(
          requestId,
          signed,
          event,
          'success',
          projectId,
          targetId,
        );
      if (path === '/api/state' && method === 'GET') {
        json(res, 200, identity ? identity.state(signed) : store.state());
        return;
      }
      if (path === '/api/info' && method === 'GET') {
        identity?.human(signed);
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
          ...(identity
            ? {
                mcpHttp: {
                  url: `${publicAddress?.origin || requestOrigin}/mcp`,
                },
              }
            : {}),
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
                    identity ? 'DDD_TOKEN' : 'DDD_CODE',
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
              ...(identity ? { DDD_TOKEN: '' } : { DDD_CODE: code }),
              DDD_AI_NAME: 'AI 도우미',
            },
          },
        });
        return;
      }
      if (path === '/api/events' && method === 'GET') {
        identity?.human(signed);
        const sessionStreams = [...clients].filter(
          (client) => client.token === signed.token,
        ).length;
        if (
          clients.size >= safeguards.maxSseClients ||
          sessionStreams >= safeguards.maxSsePerSession
        )
          rejectRateLimit();
        const initial = frame(
          'state',
          identity ? identity.state(signed) : store.state(),
        );
        if (Buffer.byteLength(initial) + 32 > safeguards.maxSseBufferBytes)
          fail(413, '현재 보드가 실시간 연결의 출력 한도를 초과했습니다.');
        const client = {
          res,
          user,
          token: signed.token,
          signed,
          closing: false,
        };
        res.on('close', () => {
          if (clients.delete(client)) presence();
        });
        clients.add(client);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.flushHeaders();
        send(client, initial);
        presence();
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
        identity?.human(signed);
        if (identity) identity.refresh(signed);
        const project = store.transaction(() => {
          const created = value.sample
            ? seedSample(store, user.name, name, description)
            : record({ name, description }, user.name);
          if (!value.sample) store.saveProject(created);
          identity?.addAdmin(signed, created.id);
          auditChange('project.create', created.id, created.id);
          return created;
        });
        broadcast();
        json(res, 201, project);
        return;
      }
      let match;
      if (
        (match = path.match(/^\/api\/projects\/([^/]+)\/review$/)) &&
        method === 'GET'
      ) {
        authorize(match[1]);
        if (!store.project(match[1])) fail(404, '프로젝트를 찾을 수 없습니다.');
        json(
          res,
          200,
          reviewBoard(
            store.state().cards.filter((c) => c.projectId === match[1]),
          ),
        );
        return;
      }
      if (
        (match = path.match(/^\/api\/projects\/([^/]+)\/export$/)) &&
        method === 'GET'
      ) {
        authorize(match[1]);
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
        auditChange('project.export', project.id, project.id);
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
        authorize(match[1], 'editor');
        if (!store.project(match[1])) fail(404, '프로젝트를 찾을 수 없습니다.');
        const fields = cardFields(value, match[1], store);
        const card = record({ projectId: match[1], ...fields }, user.name);
        store.transaction(() => {
          store.saveCard(card);
          auditChange('card.change', card.projectId, card.id);
        });
        broadcast();
        json(res, 201, card);
        return;
      }
      if (
        (match = path.match(/^\/api\/projects\/([^/]+)$/)) &&
        ['PATCH', 'DELETE'].includes(method)
      ) {
        const value = await body(req);
        authorize(match[1], 'admin', true);
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
          store.transaction(() => {
            store.deleteProject(current.id);
            auditChange('project.delete', current.id, current.id);
          });
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
        store.transaction(() => {
          store.saveProject(project);
          auditChange('project.change', project.id, project.id);
        });
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
        authorize(current.projectId, 'editor');
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
        const cards = store.transaction(() => {
          const movedCards = siblings.map((card, position) => {
            if (card.position === position) return card;
            const moved = changed(card, { position }, user);
            store.saveCard(moved);
            return moved;
          });
          auditChange('card.move', current.projectId, current.id);
          return movedCards;
        });
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
        authorize(current.projectId, 'editor');
        if (method === 'DELETE') {
          allowed(value, ['revision']);
          revision(value, current);
          store.transaction(() => {
            if (current.stage === 'contexts')
              for (const card of store
                .state()
                .cards.filter((c) => c.contextId === current.id))
                store.saveCard(changed(card, { contextId: null }, user));
            for (const linked of store
              .state()
              .cards.filter(
                (c) =>
                  c.projectId === current.projectId &&
                  c.links.some((l) => l.targetId === current.id),
              ))
              store.saveCard(
                changed(
                  linked,
                  {
                    links: linked.links.filter(
                      (l) => l.targetId !== current.id,
                    ),
                    status:
                      linked.status === 'agreed' ? 'proposed' : linked.status,
                  },
                  user,
                ),
              );
            store.deleteCard(current.id);
            auditChange('card.delete', current.projectId, current.id);
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
          'status',
          'decision',
          'scenario',
          'links',
          'revision',
        ]);
        revision(value, current);
        const fields = cardFields(value, current.projectId, store, current);
        const card = changed(current, fields, user);
        store.transaction(() => {
          store.saveCard(card);
          auditChange('card.change', card.projectId, card.id);
        });
        broadcast();
        json(res, 200, card);
        return;
      }
      fail(404, '요청한 항목을 찾을 수 없습니다.');
    } catch (error) {
      if (!res.headersSent) {
        if (!error.status) console.error('server_error', requestId);
        if (identity && !closing && [401, 403, 404, 429].includes(error.status))
          identity.audit(
            requestId,
            auditSigned,
            error.status === 429 ? 'request.limit' : 'request.denied',
            'failure',
          );
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
    for (const client of clients)
      if (live(client)) send(client, ': heartbeat\n\n');
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
      for (const client of clients) disconnect(client);
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
