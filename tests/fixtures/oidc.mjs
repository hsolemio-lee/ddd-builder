import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID, createHash, sign } from 'node:crypto';

// A real signed, single-use authorization-code provider. No app claim bypass.
export async function oidcFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const badKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'fixture',
    alg: 'RS256',
    use: 'sig',
  };
  const codes = new Map();
  let claims = {},
    fault;
  let issuer;
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const json = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return json({
        issuer,
        authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/jwks',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      });
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/authorize') {
      requests.push(Object.fromEntries(url.searchParams));
      const code = randomUUID();
      codes.set(code, {
        params: url.searchParams,
        claims: { ...claims },
        fault,
      });
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', code);
      res.writeHead(302, { location: callback.href });
      res.end();
      return;
    }
    if (url.pathname === '/token') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const p = new URLSearchParams(Buffer.concat(chunks).toString());
      const code = codes.get(p.get('code'));
      codes.delete(p.get('code'));
      if (
        !code ||
        p.get('client_id') !== 'fixture-client' ||
        p.get('client_secret') !== 'fixture-secret' ||
        p.get('redirect_uri') !== code.params.get('redirect_uri') ||
        p.get('grant_type') !== 'authorization_code' ||
        code.params.get('code_challenge_method') !== 'S256' ||
        createHash('sha256')
          .update(p.get('code_verifier') || '')
          .digest('base64url') !== code.params.get('code_challenge') ||
        code.fault === 'pkce'
      )
        return json({ error: 'invalid_grant' }, 400);
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: issuer,
        aud: 'fixture-client',
        sub: 'owner-sub',
        email: 'owner@example.com',
        email_verified: true,
        name: 'Owner',
        iat: now,
        exp: now + 300,
        nonce: code.params.get('nonce'),
        ...code.claims,
      };
      if (code.fault === 'nonce') payload.nonce = 'wrong';
      if (code.fault === 'issuer') payload.iss = 'https://other.invalid';
      if (code.fault === 'audience') payload.aud = 'other-client';
      if (code.fault === 'expiry') payload.exp = now - 600;
      const encode = (v) =>
        Buffer.from(JSON.stringify(v)).toString('base64url');
      const input =
        encode({ alg: 'RS256', kid: 'fixture', typ: 'JWT' }) +
        '.' +
        encode(payload);
      const token =
        input +
        '.' +
        sign(
          'RSA-SHA256',
          Buffer.from(input),
          code.fault === 'signature' ? badKey : privateKey,
        ).toString('base64url');
      return json({
        access_token: 'provider-access-secret',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: token,
      });
    }
    json({ error: 'not_found' }, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;
  return {
    issuer,
    requests,
    set(value = {}, error) {
      claims = value;
      fault = error;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function login(base, fixture, claims = {}, fault) {
  fixture.set(claims, fault);
  const start = await fetch(base + '/api/auth/login', { redirect: 'manual' });
  const flowCookie = start.headers.get('set-cookie')?.split(';')[0];
  const authorize = await fetch(start.headers.get('location'), {
    redirect: 'manual',
  });
  const callback = authorize.headers.get('location');
  const response = await fetch(callback, {
    headers: { cookie: flowCookie },
    redirect: 'manual',
  });
  return {
    response,
    callback,
    flowCookie,
    cookie: response.headers
      .get('set-cookie')
      ?.split(',')
      .find((c) => c.trim().startsWith('ddd_session='))
      ?.trim()
      .split(';')[0],
  };
}
