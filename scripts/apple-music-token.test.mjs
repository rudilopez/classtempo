import { generateKeyPairSync, verify } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPLE_MAX_LIFETIME_SECONDS, APPLE_MUSIC_ORIGIN, TOKEN_LIFETIME_SECONDS,
  createAppleMusicConfig, writeAppleMusicConfig,
} from './apple-music-token.mjs';

const generated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateKey = generated.privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = { APPLE_MUSIC_TEAM_ID: 'TEAM123456', APPLE_MUSIC_KEY_ID: 'KEY1234567', APPLE_MUSIC_PRIVATE_KEY: privateKey };
const nowSeconds = 1_792_886_400;
const tempDirs = [];
async function tempDirectory() {
  const dir = await mkdtemp(join(tmpdir(), 'classtempo-apple-token-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('Apple Music developer token', () => {
  it('signs the exact web claims with ES256 and a 64-byte P1363 signature', () => {
    const config = createAppleMusicConfig(env, nowSeconds);
    const [header, payload, signature] = config.developerToken.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url'))).toEqual({ alg: 'ES256', kid: env.APPLE_MUSIC_KEY_ID });
    expect(JSON.parse(Buffer.from(payload, 'base64url'))).toEqual({
      iss: env.APPLE_MUSIC_TEAM_ID, iat: nowSeconds, exp: nowSeconds + 2_592_000,
      origin: ['https://rudilopez.github.io'],
    });
    expect(Object.keys(config).sort()).toEqual(['developerToken', 'expiresAt']);
    expect(config.expiresAt).toBe(nowSeconds + TOKEN_LIFETIME_SECONDS);
    expect(config.expiresAt - nowSeconds).toBeLessThanOrEqual(APPLE_MAX_LIFETIME_SECONDS);
    expect(new URL(APPLE_MUSIC_ORIGIN).origin).toBe(APPLE_MUSIC_ORIGIN);
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    expect(verify('sha256', Buffer.from(`${header}.${payload}`),
      { key: generated.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(verify('sha256', Buffer.from(`${header}.${payload}tampered`),
      { key: generated.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(false);
    expect(config.developerToken).not.toContain(privateKey);
  });

  it('disables configuration only when all credentials are absent or blank', () => {
    expect(createAppleMusicConfig({})).toBeNull();
    expect(createAppleMusicConfig({ APPLE_MUSIC_TEAM_ID: ' ', APPLE_MUSIC_KEY_ID: '', APPLE_MUSIC_PRIVATE_KEY: '\n' })).toBeNull();
  });

  it.each(Object.keys(env))('rejects partial configuration missing %s', (missing) => {
    expect(() => createAppleMusicConfig({ ...env, [missing]: '' })).toThrow('setup is incomplete');
  });

  it.each(['short', 'ABCDEFGHIJK', 'lowercase1', 'ABCDEFGHI!', 'https://ex'])('rejects malformed identifiers: %s', (badId) => {
    for (const key of ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID']) {
      expect(() => createAppleMusicConfig({ ...env, [key]: badId })).toThrow('10 uppercase letters or digits');
    }
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects an invalid token clock %s', (clock) => {
    expect(() => createAppleMusicConfig(env, clock)).toThrow('time or lifetime is invalid');
  });

  it('rejects malformed keys without exposing their contents', () => {
    const secret = 'private-key-content-must-never-appear-in-errors';
    let error;
    try { createAppleMusicConfig({ ...env, APPLE_MUSIC_PRIVATE_KEY: secret }); } catch (caught) { error = caught; }
    expect(error.message).toContain('valid unencrypted P-256');
    expect(error.message).not.toContain(secret);
  });

  it('rejects the wrong elliptic curve and non-EC keys', () => {
    const wrongCurve = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey;
    const wrongType = generateKeyPairSync('ed25519').privateKey;
    for (const key of [wrongCurve, wrongType]) {
      expect(() => createAppleMusicConfig({ ...env, APPLE_MUSIC_PRIVATE_KEY: key.export({ type: 'pkcs8', format: 'pem' }) }))
        .toThrow('P-256 curve required by ES256');
    }
  });

  it('writes only the public schema and replaces a previous token on rerun', async () => {
    const outputPath = join(await tempDirectory(), 'public', 'apple-music-config.json');
    const first = await writeAppleMusicConfig({ env, outputPath, nowSeconds });
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(first);
    const next = await writeAppleMusicConfig({ env, outputPath, nowSeconds: nowSeconds + 7 * 86400 });
    const contents = await readFile(outputPath, 'utf8');
    expect(JSON.parse(contents)).toEqual(next);
    expect(next.expiresAt).toBe(first.expiresAt + 7 * 86400);
    expect(contents).not.toContain(first.developerToken);
    expect(contents).not.toContain('PRIVATE KEY');
  });

  it.each([{}, { APPLE_MUSIC_TEAM_ID: env.APPLE_MUSIC_TEAM_ID }, { ...env, APPLE_MUSIC_PRIVATE_KEY: 'invalid' }])
    ('removes stale configuration when credentials are absent or invalid', async (credentials) => {
      const outputPath = join(await tempDirectory(), 'apple-music-config.json');
      await writeFile(outputPath, 'stale token');
      if (Object.keys(credentials).length === 0) {
        expect(await writeAppleMusicConfig({ env: credentials, outputPath })).toBeNull();
      } else {
        await expect(writeAppleMusicConfig({ env: credentials, outputPath })).rejects.toThrow();
      }
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it.each([
    { name: 'absent', credentials: {}, status: 0, configured: false },
    { name: 'partial', credentials: { APPLE_MUSIC_PRIVATE_KEY: 'sensitive-test-marker' }, status: 1, configured: false },
    { name: 'invalid key', credentials: { ...env, APPLE_MUSIC_PRIVATE_KEY: 'sensitive-test-marker' }, status: 1, configured: false },
    { name: 'configured', credentials: env, status: 0, configured: true },
  ])('CLI handles $name setup without logging signing material or tokens', async ({ credentials, status, configured }) => {
    const dir = await tempDirectory();
    const script = join(dir, 'scripts', 'apple-music-token.mjs');
    await mkdir(join(dir, 'scripts'));
    await copyFile(new URL('./apple-music-token.mjs', import.meta.url), script);
    const result = spawnSync(process.execPath, [script], { env: credentials, encoding: 'utf8' });
    expect(result.status).toBe(status);
    expect(`${result.stdout}${result.stderr}`).not.toContain('sensitive-test-marker');
    expect(`${result.stdout}${result.stderr}`).not.toContain(privateKey);
    const outputPath = join(dir, 'apps', 'web', 'public', 'apple-music-config.json');
    if (configured) {
      const config = JSON.parse(await readFile(outputPath, 'utf8'));
      expect(config.developerToken.split('.')).toHaveLength(3);
      expect(`${result.stdout}${result.stderr}`).not.toContain(config.developerToken);
      expect(result.stdout).toContain('public configuration generated');
    } else {
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(status === 1 ? result.stderr : result.stdout).toMatch(/Apple Music|APPLE_MUSIC_PRIVATE_KEY/);
    }
  });
});
