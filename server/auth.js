import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';
import { getUserByEmail, addUser, updateUser, createSession, getSessionUser, deleteSession } from './db.js';

// Google sign-in. The web UI obtains an ID token (a signed JWT) from Google
// Identity Services; we verify it against Google's published keys and map the
// email to a row in the users table. No client secret is involved — only the
// public client id, which also gates which tokens we accept (aud claim).
//
// Auth is enabled by setting JOBTRACKER_GOOGLE_CLIENT_ID. Without it the app
// runs in the original local single-user mode: no sign-in, every request is
// treated as an admin. JOBTRACKER_ADMIN_EMAILS (comma-separated) seeds admin
// accounts on their first sign-in so the deployment is never locked out.

export const GOOGLE_CLIENT_ID = process.env.JOBTRACKER_GOOGLE_CLIENT_ID || '';
export const authEnabled = () => Boolean(GOOGLE_CLIENT_ID);

const ADMIN_EMAILS = (process.env.JOBTRACKER_ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Stands in for a signed-in admin while auth is disabled (local mode).
const LOCAL_ADMIN = { id: 0, email: '', name: 'Local admin', picture: '', role: 'admin', person_id: null };

const COOKIE_NAME = 'jt_session';

// ---- Google ID token verification ----

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let certCache = { keys: null, fetchedAt: 0 };

async function googleKeys() {
  // Google rotates keys rarely; cache for an hour and refetch on a miss.
  if (!certCache.keys || Date.now() - certCache.fetchedAt > 60 * 60 * 1000) {
    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new Error(`Could not fetch Google signing keys (${res.status})`);
    certCache = { keys: (await res.json()).keys, fetchedAt: Date.now() };
  }
  return certCache.keys;
}

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// Verifies signature and claims of a Google ID token; returns its payload.
export async function verifyGoogleIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  let header, payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    throw new Error('Malformed ID token');
  }
  if (header.alg !== 'RS256') throw new Error(`Unexpected token algorithm "${header.alg}"`);

  let keys = await googleKeys();
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) {
    // Key rotation between cache refreshes — refetch once.
    certCache = { keys: null, fetchedAt: 0 };
    keys = await googleKeys();
    jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) throw new Error('Token signed with an unknown Google key');
  }
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  const valid = verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!valid) throw new Error('Invalid token signature');

  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('Token not issued by Google');
  }
  if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('Token issued for a different application');
  if (payload.exp * 1000 < Date.now()) throw new Error('Token expired — try signing in again');
  if (!payload.email || payload.email_verified !== true) throw new Error('Google account email is not verified');
  return payload;
}

// ---- Sessions ----

function parseCookies(req) {
  const out = {};
  for (const pair of (req.headers.cookie || '').split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

// True when the original request was HTTPS (directly or via the reverse
// proxy) — governs the cookie's Secure flag so local http still works.
function isHttps(req) {
  return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(req, token, maxAge) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    + (isHttps(req) ? '; Secure' : '');
}

// The signed-in user for this request, or null. While auth is disabled every
// request acts as a local admin (the app's original single-user behavior).
export function requestUser(req) {
  if (!authEnabled()) return LOCAL_ADMIN;
  return getSessionUser(parseCookies(req)[COOKIE_NAME]);
}

// Public shape of a user, for /api/me and the sign-in response.
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    person_id: user.person_id,
    auth_enabled: authEnabled()
  };
}

// ---- Auth HTTP endpoints (/api/auth/*) ----

export async function handleAuth(req, res, url, { json, readBody }) {
  // The sign-in page needs the client id before anyone is signed in.
  if (req.method === 'GET' && url.pathname === '/api/auth/config') {
    return json(res, 200, { auth_enabled: authEnabled(), google_client_id: GOOGLE_CLIENT_ID });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/google') {
    if (!authEnabled()) return json(res, 400, { error: 'Authentication is not enabled on this server' });
    const body = await readBody(req);
    let payload;
    try {
      payload = await verifyGoogleIdToken(body.credential);
    } catch (err) {
      return json(res, 401, { error: err.message });
    }
    let user = getUserByEmail(payload.email);
    // Emails listed in JOBTRACKER_ADMIN_EMAILS self-provision as admins;
    // everyone else must have been invited (added to users) by an admin.
    if (!user && ADMIN_EMAILS.includes(payload.email.toLowerCase())) {
      user = addUser({ email: payload.email, role: 'admin' });
    }
    if (!user) {
      return json(res, 403, { error: `${payload.email} has not been invited to this JobTracker. Ask the administrator for access.` });
    }
    user = updateUser(user.id, {
      name: payload.name || user.name,
      picture: payload.picture || user.picture,
      last_login_at: new Date().toISOString()
    });
    const session = createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(req, session.token, session.max_age));
    return json(res, 200, publicUser(user));
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    deleteSession(parseCookies(req)[COOKIE_NAME]);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return json(res, 200, { signed_out: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = requestUser(req);
    if (!user) return json(res, 401, { error: 'Not signed in', auth_enabled: authEnabled() });
    return json(res, 200, publicUser(user));
  }

  return json(res, 404, { error: 'Unknown auth route' });
}

// ---- Bearer-token check for the remote MCP endpoint ----

const MCP_TOKEN = process.env.JOBTRACKER_MCP_TOKEN || '';

export function mcpTokenConfigured() {
  return Boolean(MCP_TOKEN);
}

export function checkMcpToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!MCP_TOKEN || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(MCP_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
