const encoder = new TextEncoder();
const SESSION_DAYS = 30;
const MAX_SYNC_BYTES = 4_000_000;
const OAUTH_STATE_COOKIE = 'aks_oauth_state';
const OAUTH_NONCE_COOKIE = 'aks_oauth_nonce';
const OAUTH_CLIENT_COOKIE = 'aks_oauth_client';
const OAUTH_REDIRECT_COOKIE = 'aks_oauth_redirect';
const MOBILE_OAUTH_CODE_MINUTES = 5;
// Cloudflare Workers caps WebCrypto PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;

export async function handleAccountRequest(request, env, pathname) {
  if (pathname === '/api/auth/providers') return authProviders(request, env);
  if (pathname === '/api/auth/oauth/mobile/exchange') return mobileOAuthExchange(request, env);
  const oauthMatch = pathname.match(/^\/api\/auth\/oauth\/(google|apple)\/(start|callback)$/);
  if (oauthMatch) return oauth(request, env, oauthMatch[1], oauthMatch[2]);
  if (pathname === '/api/auth/register') return register(request, env);
  if (pathname === '/api/auth/login') return login(request, env);
  if (pathname === '/api/auth/logout') return logout(request, env);
  if (pathname === '/api/auth/delete') return deleteAccount(request, env);
  if (pathname === '/api/me') return me(request, env);
  if (pathname === '/api/sync/pull') return pull(request, env);
  if (pathname === '/api/sync/push') return push(request, env);
  return null;
}

async function authProviders(request, env) {
  if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  return json({
    providers: {
      google: oauthConfig(env, 'google').ready,
      apple: oauthConfig(env, 'apple').ready,
    },
  });
}

async function oauth(request, env, provider, action) {
  if (action === 'start') return oauthStart(request, env, provider);
  return oauthCallback(request, env, provider);
}

async function oauthStart(request, env, provider) {
  if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  const config = oauthConfig(env, provider);
  if (!config.ready) return oauthErrorRedirect(request, 'OAUTH_PROVIDER_NOT_CONFIGURED');
  const url = new URL(request.url);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const mobile = url.searchParams.get('client') === 'mobile';
  const mobileRedirect = mobileRedirectUri(url.searchParams.get('redirect_uri'));
  const redirectUri = oauthRedirectUri(request, provider);
  const destination = new URL(config.authorizationUrl);
  destination.searchParams.set('client_id', config.clientId);
  destination.searchParams.set('redirect_uri', redirectUri);
  destination.searchParams.set('response_type', 'code');
  destination.searchParams.set('scope', config.scope);
  destination.searchParams.set('state', state);
  destination.searchParams.set('nonce', nonce);
  if (provider === 'apple') destination.searchParams.set('response_mode', 'form_post');
  const headers = new Headers({ Location: destination.toString() });
  headers.append('Set-Cookie', shortCookie(OAUTH_STATE_COOKIE, state));
  headers.append('Set-Cookie', shortCookie(OAUTH_NONCE_COOKIE, nonce));
  if (mobile) headers.append('Set-Cookie', shortCookie(OAUTH_CLIENT_COOKIE, 'mobile'));
  if (mobile && mobileRedirect) headers.append('Set-Cookie', shortCookie(OAUTH_REDIRECT_COOKIE, mobileRedirect));
  headers.append('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}

async function oauthCallback(request, env, provider) {
  if (request.method !== 'GET' && request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405, { Allow: 'GET, POST' });
  const values = request.method === 'POST' ? await request.formData().then(form => Object.fromEntries(form.entries())).catch(() => ({})) : Object.fromEntries(new URL(request.url).searchParams.entries());
  const expectedState = cookie(request, OAUTH_STATE_COOKIE);
  const expectedNonce = cookie(request, OAUTH_NONCE_COOKIE);
  const mobile = cookie(request, OAUTH_CLIENT_COOKIE) === 'mobile';
  const mobileRedirect = mobileRedirectUri(cookie(request, OAUTH_REDIRECT_COOKIE));
  const clearHeaders = [clearNamedCookie(OAUTH_STATE_COOKIE), clearNamedCookie(OAUTH_NONCE_COOKIE), clearNamedCookie(OAUTH_CLIENT_COOKIE), clearNamedCookie(OAUTH_REDIRECT_COOKIE)];
  if (!values.code || !values.state || !expectedState || !constantEqual(String(values.state), expectedState)) return oauthErrorRedirect(request, 'OAUTH_STATE_INVALID', clearHeaders, mobileRedirect);
  const config = oauthConfig(env, provider);
  if (!config.ready) return oauthErrorRedirect(request, 'OAUTH_PROVIDER_NOT_CONFIGURED', clearHeaders, mobileRedirect);
  try {
    const token = await exchangeOAuthCode(request, config, provider, String(values.code));
    const claims = await decodeAndVerifyIdToken(token.id_token, config);
    validateIdTokenClaims(claims, config, expectedNonce);
    const email = normalizeEmail(claims.email);
    if (!email) throw coded('OAUTH_EMAIL_MISSING');
    const user = await upsertOAuthUser(env, provider, String(claims.sub), email);
    if (mobile && mobileRedirect) return issueMobileOAuthCode(env, user.id, mobileRedirect, clearHeaders);
    return issueSession(env, user.id, user.email, 303, { Location: new URL('/', request.url).toString(), 'Set-Cookie': clearHeaders });
  } catch (error) {
    return oauthErrorRedirect(request, error.code || 'OAUTH_FAILED', clearHeaders, mobileRedirect);
  }
}

async function mobileOAuthExchange(request, env) {
  if (!isJsonPost(request)) return methodOrTypeError(request);
  if (!sameOrigin(request)) return error('AUTH_ORIGIN_INVALID', 403);
  if (!mobileClient(request)) return error('MOBILE_CLIENT_REQUIRED', 403);
  const { code } = await body(request);
  const codeText = String(code || '').trim();
  if (!codeText) return error('OAUTH_CODE_INVALID', 400);
  const hash = await tokenDigest(codeText);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT mobile_oauth_codes.id, mobile_oauth_codes.user_id, users.email
    FROM mobile_oauth_codes
    JOIN users ON users.id = mobile_oauth_codes.user_id
    WHERE mobile_oauth_codes.code_hash = ?
      AND mobile_oauth_codes.expires_at > ?
      AND mobile_oauth_codes.used_at IS NULL
      AND users.deleted_at IS NULL`).bind(hash, now).first();
  if (!row) return error('OAUTH_CODE_INVALID', 401);
  await env.DB.prepare('UPDATE mobile_oauth_codes SET used_at = ? WHERE id = ?').bind(now, row.id).run();
  return issueSession(env, row.user_id, row.email, 201, { 'X-Reptrio-Client': 'mobile' });
}

async function exchangeOAuthCode(request, config, provider, code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: provider === 'apple' ? await appleClientSecret(config) : config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: oauthRedirectUri(request, provider)
  });
  const response = await fetch(config.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id_token) throw coded(mapOAuthTokenError(payload.error));
  return payload;
}

function validateIdTokenClaims(claims, config, expectedNonce) {
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer) throw coded('OAUTH_ISSUER_INVALID');
  if (claims.aud !== config.clientId) throw coded('OAUTH_AUDIENCE_INVALID');
  if (Number(claims.exp || 0) <= now) throw coded('OAUTH_TOKEN_EXPIRED');
  if (!expectedNonce || !claims.nonce || !constantEqual(String(claims.nonce), expectedNonce)) throw coded('OAUTH_NONCE_INVALID');
  if (!claims.sub) throw coded('OAUTH_SUBJECT_MISSING');
}

async function upsertOAuthUser(env, provider, subject, email) {
  const now = new Date().toISOString();
  const linked = await env.DB.prepare('SELECT users.id, users.email FROM oauth_accounts JOIN users ON users.id = oauth_accounts.user_id WHERE oauth_accounts.provider = ? AND oauth_accounts.provider_subject = ? AND users.deleted_at IS NULL').bind(provider, subject).first();
  if (linked) {
    await env.DB.prepare('UPDATE oauth_accounts SET email = ?, last_login_at = ? WHERE provider = ? AND provider_subject = ?').bind(email, now, provider, subject).run();
    return linked;
  }
  let user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ? AND deleted_at IS NULL').bind(email).first();
  if (!user) {
    const id = crypto.randomUUID();
    const salt = randomToken(16);
    const passwordHash = await passwordDigest(randomToken(32), salt);
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, email, passwordHash, salt, now).run();
    user = { id, email };
  }
  await env.DB.prepare('INSERT INTO oauth_accounts (provider, provider_subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)').bind(provider, subject, user.id, email, now, now).run();
  return user;
}

async function register(request, env) {
  if (!isJsonPost(request)) return methodOrTypeError(request);
  if (!sameOrigin(request)) return error('AUTH_ORIGIN_INVALID', 403);
  const { email, password } = await body(request);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return error('AUTH_INVALID_EMAIL', 400);
  if (!validPassword(password)) return error('AUTH_PASSWORD_TOO_SHORT', 400);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').bind(normalizedEmail).first();
  if (exists) return error('AUTH_EMAIL_IN_USE', 409);
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const salt = randomToken(16); const passwordHash = await passwordDigest(password, salt);
  await env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, normalizedEmail, passwordHash, salt, now).run();
  return issueSession(env, id, normalizedEmail, 201, mobileClient(request) ? { 'X-Reptrio-Client': 'mobile' } : {});
}

async function login(request, env) {
  if (!isJsonPost(request)) return methodOrTypeError(request);
  if (!sameOrigin(request)) return error('AUTH_ORIGIN_INVALID', 403);
  const { email, password } = await body(request); const normalizedEmail = normalizeEmail(email);
  const user = normalizedEmail && await env.DB.prepare('SELECT id, email, password_hash, password_salt FROM users WHERE email = ? AND deleted_at IS NULL').bind(normalizedEmail).first();
  if (!user || !validPassword(password) || !constantEqual(await passwordDigest(password, user.password_salt), user.password_hash)) return error('AUTH_INVALID_CREDENTIALS', 401);
  return issueSession(env, user.id, user.email, 201, mobileClient(request) ? { 'X-Reptrio-Client': 'mobile' } : {});
}

async function logout(request, env) {
  if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405, { Allow: 'POST' });
  if (!sameOrigin(request)) return error('AUTH_ORIGIN_INVALID', 403);
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await tokenDigest(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}

async function me(request, env) {
  if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  const user = await currentUser(request, env);
  return user ? json({ user: { id: user.id, email: user.email } }) : error('AUTH_REQUIRED', 401);
}

async function pull(request, env) {
  if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  const user = await currentUser(request, env); if (!user) return error('AUTH_REQUIRED', 401);
  const row = await env.DB.prepare('SELECT payload_json, sync_version, updated_at FROM user_data WHERE user_id = ?').bind(user.id).first();
  return json({ data: row ? JSON.parse(row.payload_json) : null, syncVersion: row?.sync_version || 0, updatedAt: row?.updated_at || null });
}

async function push(request, env) {
  if (!isJsonPost(request)) return methodOrTypeError(request);
  if (!sameOrigin(request)) return error('AUTH_ORIGIN_INVALID', 403);
  const user = await currentUser(request, env); if (!user) return error('AUTH_REQUIRED', 401);
  const payload = await body(request); const serialized = JSON.stringify(payload?.data);
  if (!payload?.data || bytes(serialized) > MAX_SYNC_BYTES) return error('SYNC_PAYLOAD_INVALID', 413);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare('SELECT sync_version FROM user_data WHERE user_id = ?').bind(user.id).first();
  const expectedVersion = Number(payload.syncVersion || 0);
  if (existing && expectedVersion !== Number(existing.sync_version)) return error('SYNC_CONFLICT', 409, { 'X-Sync-Version': String(existing.sync_version) });
  const version = Number(existing?.sync_version || 0) + 1;
  const records = materializeRecords(env.DB, user.id, payload.data, now);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user_data (user_id, payload_json, sync_version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET payload_json = excluded.payload_json, sync_version = excluded.sync_version, updated_at = excluded.updated_at').bind(user.id, serialized, version, now),
    env.DB.prepare('INSERT INTO user_settings (user_id, payload_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at').bind(user.id, JSON.stringify(payload.data.settings || {}), now),
    env.DB.prepare('INSERT INTO sync_metadata (user_id, sync_version, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET sync_version = excluded.sync_version, updated_at = excluded.updated_at').bind(user.id, version, now),
    env.DB.prepare('DELETE FROM programs WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM workout_sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM workout_sets WHERE user_id = ?').bind(user.id),
    ...records.programs,
    ...records.sessions,
    ...records.sets
  ]);
  return json({ ok: true, syncVersion: version, updatedAt: now });
}

async function deleteAccount(request, env) {
  if (!isJsonPost(request)) return methodOrTypeError(request);
  if (!sameOrigin(request)) return error('AUTH_ORIGIN_INVALID', 403);
  const user = await currentUser(request, env); if (!user) return error('AUTH_REQUIRED', 401);
  const { confirm, password } = await body(request); if (confirm !== 'DELETE') return error('ACCOUNT_DELETE_CONFIRMATION_REQUIRED', 400);
  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').bind(user.id).first();
  if (!row || !constantEqual(await passwordDigest(password || '', row.password_salt), row.password_hash)) return error('AUTH_INVALID_CREDENTIALS', 401);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM user_data WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM programs WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM workout_sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM workout_sets WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sync_metadata WHERE user_id = ?').bind(user.id),
    env.DB.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').bind(new Date().toISOString(), user.id)
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}

async function issueSession(env, id, email, status = 201, extraHeaders = {}) {
  const token = randomToken(32); const now = new Date(); const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await env.DB.prepare('INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, await tokenDigest(token), now.toISOString(), expires.toISOString()).run();
  const mobile = extraHeaders['X-Reptrio-Client'] === 'mobile';
  const publicHeaders = { ...extraHeaders };
  delete publicHeaders['X-Reptrio-Client'];
  return json({ user: { id, email }, ...(mobile ? { sessionToken: token, expiresAt: expires.toISOString() } : {}) }, status, { ...publicHeaders, 'Set-Cookie': [sessionCookie(token, expires), ...asArray(publicHeaders['Set-Cookie'])] });
}

async function issueMobileOAuthCode(env, userId, redirectUri, cookies = []) {
  const code = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + MOBILE_OAUTH_CODE_MINUTES * 60000);
  await env.DB.prepare('INSERT INTO mobile_oauth_codes (id, user_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, await tokenDigest(code), now.toISOString(), expires.toISOString()).run();
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  const headers = new Headers({ Location: url.toString(), 'Cache-Control': 'no-store' });
  cookies.forEach(value => headers.append('Set-Cookie', value));
  return new Response(null, { status: 303, headers });
}

export async function currentUser(request, env) {
  const token = sessionToken(request); if (!token) return null;
  const row = await env.DB.prepare('SELECT users.id, users.email FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ? AND users.deleted_at IS NULL').bind(await tokenDigest(token), new Date().toISOString()).first();
  return row || null;
}

function isJsonPost(request) { return request.method === 'POST' && request.headers.get('content-type')?.toLowerCase().startsWith('application/json'); }
function sameOrigin(request) { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }
function mobileClient(request) { return request.headers.get('x-reptrio-client') === 'mobile'; }
function methodOrTypeError(request) { return request.method !== 'POST' ? error('METHOD_NOT_ALLOWED', 405, { Allow: 'POST' }) : error('UNSUPPORTED_CONTENT_TYPE', 415); }
async function body(request) { try { return await request.json(); } catch { return {}; } }
function normalizeEmail(value) { const email = String(value || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null; }
function validPassword(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 200; }
async function passwordDigest(password, salt) { const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt), iterations: PBKDF2_ITERATIONS }, key, 256); return base64Url(new Uint8Array(bits)); }
async function tokenDigest(token) { const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token)); return base64Url(new Uint8Array(digest)); }
function randomToken(length) { const bytes = crypto.getRandomValues(new Uint8Array(length)); return base64Url(bytes); }
function base64Url(bytes) { let text = ''; bytes.forEach(byte => { text += String.fromCharCode(byte); }); return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function fromBase64Url(value) { const text = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='); const binary = atob(text); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function constantEqual(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let result = 0; for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index); return result === 0; }
function cookie(request, name) { return request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || null; }
function bearer(request) { const value = request.headers.get('authorization') || ''; const match = value.match(/^Bearer\s+(.+)$/i); return match ? match[1].trim() : null; }
function sessionToken(request) { return bearer(request) || cookie(request, 'aks_session'); }
function sessionCookie(token, expires) { return `aks_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires.toUTCString()}`; }
function clearCookie() { return 'aks_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'; }
function shortCookie(name, value) { return `${name}=${value}; Path=/api/auth/oauth/; HttpOnly; Secure; SameSite=None; Max-Age=600`; }
function clearNamedCookie(name) { return `${name}=; Path=/api/auth/oauth/; HttpOnly; Secure; SameSite=None; Max-Age=0`; }
function bytes(value) { return encoder.encode(value).byteLength; }
function materializeRecords(db, userId, data, now) {
  const programs = (data.programs || []).filter(item => item?.id).map(item => sqlRecord(db, 'programs', userId, item.id, item, now));
  const sessions = (data.sessions || []).filter(item => item?.id).map(item => sqlRecord(db, 'workout_sessions', userId, item.id, item, now));
  const sets = (data.sessions || []).flatMap(session => Object.entries(session?.sets || {}).flatMap(([exerciseId, entries]) => Object.entries(entries || {}).map(([setNumber, entry]) => sqlSet(db, userId, `${session.id}:${exerciseId}:${setNumber}`, session.id, { exerciseId, setNumber: Number(setNumber), ...entry }, now))));
  return { programs, sessions, sets };
}
function sqlRecord(db, table, userId, id, payload, now) { return db.prepare(`INSERT INTO ${table} (id, user_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(id, userId, JSON.stringify(payload), payload.createdAt || now, payload.updatedAt || now); }
function sqlSet(db, userId, id, sessionId, payload, now) { return db.prepare('INSERT INTO workout_sets (id, user_id, session_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, userId, sessionId, JSON.stringify(payload), now, now); }
function json(value, status = 200, headers = {}) {
  const responseHeaders = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  Object.entries(headers).forEach(([key, value]) => {
    asArray(value).forEach(item => responseHeaders.append(key, item));
  });
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}
function error(code, status, headers) { return json({ code }, status, headers); }
function oauthErrorRedirect(request, code, cookies = [], mobileRedirect = null) {
  const url = new URL(mobileRedirect || '/', request.url);
  url.searchParams.set('auth_error', code);
  const headers = new Headers({ Location: url.toString(), 'Cache-Control': 'no-store' });
  cookies.forEach(value => headers.append('Set-Cookie', value));
  return new Response(null, { status: 303, headers });
}
function oauthRedirectUri(request, provider) { return new URL(`/api/auth/oauth/${provider}/callback`, request.url).toString(); }
function mobileRedirectUri(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'reptrio:' ? url.toString() : null;
  } catch {
    return null;
  }
}
function oauthConfig(env, provider) {
  if (provider === 'google') return {
    provider,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    scope: 'openid email profile',
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    ready: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET)
  };
  return {
    provider,
    authorizationUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuer: 'https://appleid.apple.com',
    scope: 'openid email',
    clientId: env.APPLE_OAUTH_CLIENT_ID,
    teamId: env.APPLE_OAUTH_TEAM_ID,
    keyId: env.APPLE_OAUTH_KEY_ID,
    privateKey: env.APPLE_OAUTH_PRIVATE_KEY,
    ready: Boolean(env.APPLE_OAUTH_CLIENT_ID && env.APPLE_OAUTH_TEAM_ID && env.APPLE_OAUTH_KEY_ID && env.APPLE_OAUTH_PRIVATE_KEY)
  };
}
async function appleClientSecret(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const payload = { iss: config.teamId, iat: now, exp: now + 3600, aud: 'https://appleid.apple.com', sub: config.clientId };
  const input = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(config.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(input)));
  return `${input}.${base64Url(signature)}`;
}
function decodeJwt(token) {
  const [, payload] = String(token || '').split('.');
  if (!payload) throw coded('OAUTH_TOKEN_INVALID');
  try { return JSON.parse(new TextDecoder().decode(fromBase64Url(payload))); }
  catch { throw coded('OAUTH_TOKEN_INVALID'); }
}
async function decodeAndVerifyIdToken(token, config) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw coded('OAUTH_TOKEN_INVALID');
  const [headerPart, payloadPart, signaturePart] = parts;
  let header;
  try { header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerPart))); }
  catch { throw coded('OAUTH_TOKEN_INVALID'); }
  if (header.alg !== 'RS256' || !header.kid) throw coded('OAUTH_TOKEN_INVALID');
  const response = await fetch(config.jwksUrl, { headers: { Accept: 'application/json' } });
  const jwks = await response.json().catch(() => ({}));
  const jwk = Array.isArray(jwks.keys) && jwks.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!response.ok || !jwk) throw coded('OAUTH_KEY_NOT_FOUND');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`));
  if (!valid) throw coded('OAUTH_SIGNATURE_INVALID');
  return decodeJwt(token);
}
function pemToArrayBuffer(pem) {
  const clean = String(pem).replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  return fromBase64Url(clean.replaceAll('+', '-').replaceAll('/', '_'));
}
function base64UrlJson(value) { return base64Url(encoder.encode(JSON.stringify(value))); }
function asArray(value) { return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []; }
function mapOAuthTokenError(code) { return code === 'invalid_client' ? 'OAUTH_CLIENT_INVALID' : code === 'invalid_grant' ? 'OAUTH_CODE_INVALID' : 'OAUTH_TOKEN_EXCHANGE_FAILED'; }
function coded(code) { return Object.assign(new Error(code), { code }); }
