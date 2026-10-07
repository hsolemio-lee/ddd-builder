import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp, shareUrls } from './app.mjs';
import { validateAuthConfig } from './identity.mjs';

const root = resolve(import.meta.dirname, '..');
const serviceMode =
  process.env.SERVICE_MODE ||
  (process.env.NODE_ENV === 'production' ? 'production' : 'workshop');
const auth = {
  mode:
    process.env.AUTH_MODE || (serviceMode === 'production' ? 'oidc' : 'legacy'),
  issuer: process.env.OIDC_ISSUER,
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  ownerEmail: process.env.OWNER_EMAIL,
};
validateAuthConfig(auth, serviceMode, process.env.PUBLIC_URL);
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3210);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('PORT는 0부터 65535 사이의 숫자여야 합니다.');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const codePath = join(dataDir, 'access-code');
let code = process.env.ACCESS_CODE?.trim();
if (auth.mode === 'legacy' && !code) {
  try {
    code = (await readFile(codePath, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!code) {
    code = randomBytes(18).toString('base64url');
    try {
      await writeFile(codePath, code + '\n', { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      code = (await readFile(codePath, 'utf8')).trim();
    }
  }
  await chmod(codePath, 0o600);
} else if (auth.mode === 'legacy') {
  await writeFile(codePath, code + '\n', { mode: 0o600 });
  await chmod(codePath, 0o600);
}
const app = await createApp({
  dataDir,
  code,
  auth,
  serviceMode,
  host,
  port,
  staticDir: join(root, 'dist'),
  publicUrl: process.env.PUBLIC_URL || undefined,
  mcpContainerName: process.env.MCP_CONTAINER_NAME || undefined,
});
console.log(
  `DDD Builder 실행 중\n${shareUrls(host, app.server.address().port, undefined, { publicUrl: process.env.PUBLIC_URL || undefined, containerized: Boolean(process.env.MCP_CONTAINER_NAME) }).join('\n')}${auth.mode === 'legacy' ? `\n접속 코드 파일: ${codePath}` : '\n개인 계정 인증: OIDC'}\n데이터: ${dataDir}`,
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
