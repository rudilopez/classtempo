import { createPrivateKey, sign } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPLE_MUSIC_ORIGIN = 'https://rudilopez.github.io';
export const TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const APPLE_MAX_LIFETIME_SECONDS = 15_777_000;
export const CONFIG_PATH = fileURLToPath(new URL('../apps/web/public/apple-music-config.json', import.meta.url));

const SECRET_NAMES = ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID', 'APPLE_MUSIC_PRIVATE_KEY'];

/** Sign only in Node/the deployment runner. Never import this module into browser code. */
export function createAppleMusicConfig(env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const values = SECRET_NAMES.map((name) => typeof env[name] === 'string' ? env[name].trim() : '');
  if (values.every((value) => value === '')) return null;
  if (values.some((value) => value === '')) {
    throw new Error('Apple Music setup is incomplete: set all three APPLE_MUSIC secrets, or remove all three to disable it.');
  }
  const [teamId, keyId, privateKeyPem] = values;
  if (!/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Z0-9]{10}$/.test(keyId)) {
    throw new Error('Apple Music Team ID and Key ID must each contain 10 uppercase letters or digits.');
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0 ||
      !Number.isSafeInteger(nowSeconds + TOKEN_LIFETIME_SECONDS) ||
      TOKEN_LIFETIME_SECONDS > APPLE_MAX_LIFETIME_SECONDS) {
    throw new Error('Apple Music token time or lifetime is invalid.');
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    // Do not echo the PEM, environment, or crypto errors into public Actions logs.
    throw new Error('APPLE_MUSIC_PRIVATE_KEY must be a valid unencrypted P-256 private key in PEM format.');
  }
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('APPLE_MUSIC_PRIVATE_KEY must use the P-256 curve required by ES256.');
  }

  const expiresAt = nowSeconds + TOKEN_LIFETIME_SECONDS;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'ES256', kid: keyId });
  const payload = encode({ iss: teamId, iat: nowSeconds, exp: expiresAt, origin: [APPLE_MUSIC_ORIGIN] });
  const signingInput = `${header}.${payload}`;
  // JWT ES256 requires the 64-byte R || S form, not OpenSSL's default DER signature.
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return { developerToken: `${signingInput}.${signature.toString('base64url')}`, expiresAt };
}

/** Clear a previous build's token even when credentials are removed or now invalid. */
export async function writeAppleMusicConfig({ env = process.env, outputPath = CONFIG_PATH, nowSeconds } = {}) {
  await rm(outputPath, { force: true });
  const config = createAppleMusicConfig(env, nowSeconds);
  if (!config) return null;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config)}\n`, { encoding: 'utf8', mode: 0o644 });
  return config;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = await writeAppleMusicConfig();
    console.log(config
      ? `Apple Music public configuration generated; expires ${new Date(config.expiresAt * 1000).toISOString()}.`
      : 'Apple Music is not configured; no public configuration generated.');
  } catch (error) {
    // Only our fixed validation messages are safe to print. File/crypto errors may expose paths or input.
    const message = error instanceof Error &&
      /^(Apple Music (setup is incomplete:|Team ID and Key ID must|token time or lifetime is invalid\.)|APPLE_MUSIC_PRIVATE_KEY must)/.test(error.message)
      ? error.message : 'Apple Music configuration could not be generated.';
    console.error(message);
    process.exitCode = 1;
  }
}
