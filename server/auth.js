import crypto from 'node:crypto';

/**
 * Password hashing and session handling.
 *
 * scrypt comes with Node, so there is no native dependency to build. Passwords
 * are never stored or logged in the clear - only the salt and derived key are
 * written to disk, and comparison is timing-safe.
 */

const KEY_LEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS).toString('hex');
  return { salt, key };
}

export function verifyPassword(password, record) {
  if (!record?.salt || !record?.key) return false;
  const attempt = crypto.scryptSync(password, record.salt, KEY_LEN, SCRYPT_PARAMS);
  const stored = Buffer.from(record.key, 'hex');
  // timingSafeEqual throws on a length mismatch, so guard before comparing.
  if (stored.length !== attempt.length) return false;
  return crypto.timingSafeEqual(stored, attempt);
}

/**
 * Sessions live in memory: restarting the server signs everyone out, which is
 * the right trade for a single-admin CMS that needs no session store.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

export function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function readSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function destroySession(token) {
  if (token) sessions.delete(token);
}

export const SESSION_COOKIE = 'beanery_session';

export function requireAuth(req, res, next) {
  const session = readSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  req.user = { username: session.username };
  next();
}
