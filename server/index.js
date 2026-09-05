// Must come first: it populates process.env for every module below.
import './env.js';

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';

import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  readSession,
  requireAuth,
  verifyPassword,
} from './auth.js';
import {
  UPLOADS_DIR,
  addUpload,
  getAdmin,
  getContent,
  listUploads,
  removeUpload,
  setContent,
} from './store.js';
import { normaliseContent } from './validate.js';
import {
  googleAllowlistEmpty,
  googleClientId,
  googleConfigured,
  verifyGoogleCredential,
} from './google.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* ---------------------------------------------------------------- uploads -- */

const ALLOWED_TYPES = new Map([
  ['image/webp', '.webp'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/avif', '.avif'],
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    // Never trust the client's filename on disk - generate our own and keep
    // the original only as a display label.
    filename: (req, file, cb) =>
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ALLOWED_TYPES.get(file.mimetype)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      cb(new Error('Only WebP, JPEG, PNG or AVIF images are allowed'));
      return;
    }
    cb(null, true);
  },
});

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1y', immutable: true }));

/* ------------------------------------------------------------------- auth -- */

function issueSession(res, username) {
  res.cookie(SESSION_COOKIE, createSession(username), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

app.post('/api/auth/google', async (req, res) => {
  if (!googleConfigured()) {
    res.status(503).json({ error: 'Google sign-in is not configured on this server' });
    return;
  }
  try {
    const user = await verifyGoogleCredential(req.body?.credential);
    issueSession(res, user.username);
    res.json(user);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  // With Google configured it is the only way in - a password route left live
  // alongside it would be a second, weaker door.
  if (googleConfigured()) {
    res.status(403).json({ error: 'This site uses Google sign-in.' });
    return;
  }

  const { username, password } = req.body ?? {};
  const admin = getAdmin();

  if (!admin) {
    res.status(503).json({ error: 'No admin account yet. Run: npm run admin:password' });
    return;
  }
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }
  if (username !== admin.username || !verifyPassword(password, admin)) {
    // One message for both cases, so this cannot be used to probe for a
    // valid username.
    res.status(401).json({ error: 'Incorrect username or password' });
    return;
  }

  issueSession(res, admin.username);
  res.json({ username: admin.username });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = readSession(req.cookies?.[SESSION_COOKIE]);
  const google = googleConfigured();
  res.json({
    user: session ? { username: session.username } : null,
    authMode: google ? 'google' : 'password',
    googleClientId: google ? googleClientId() : '',
    // Configured with nobody allowed in: the UI says so rather than showing a
    // button that can only ever fail.
    googleAllowlistEmpty: google ? googleAllowlistEmpty() : false,
    hasAdmin: Boolean(getAdmin()),
  });
});

/* ---------------------------------------------------------------- content -- */

app.get('/api/content', (req, res) => {
  res.json(getContent());
});

app.put('/api/content', requireAuth, (req, res) => {
  const uploadUrls = new Set(listUploads().map((u) => u.url));
  res.json(setContent(normaliseContent(req.body, getContent(), uploadUrls)));
});

/* ------------------------------------------------------------ upload CRUD -- */

app.get('/api/uploads', requireAuth, (req, res) => {
  res.json(listUploads());
});

app.post('/api/uploads', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image received' });
    return;
  }
  res.status(201).json(
    addUpload({
      id: path.parse(req.file.filename).name,
      url: `/uploads/${req.file.filename}`,
      name: String(req.file.originalname || '').slice(0, 120),
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    }),
  );
});

app.delete('/api/uploads/:id', requireAuth, (req, res) => {
  const entry = removeUpload(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'No such upload' });
    return;
  }

  // Drop any slot still pointing at the deleted file, so the site falls back
  // to its bundled photograph instead of a dead URL.
  const content = getContent();
  const images = Object.fromEntries(
    Object.entries(content.images).filter(([, url]) => url !== entry.url),
  );
  setContent({ ...content, images });

  fs.rm(path.join(UPLOADS_DIR, path.basename(entry.url)), { force: true }, () => {});
  res.json({ ok: true });
});

/* -------------------------------------------------------- built site (prod) */

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/admin\/?$/, (req, res) => res.sendFile(path.join(distDir, 'admin.html')));
  app.use((req, res, next) => {
    // The SPA fallback must not swallow API or upload paths: a missing image
    // has to 404, not resolve to the site's HTML with a 200.
    const passThrough =
      req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/');
    if (passThrough) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// multer and the upload filter surface their failures here.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const tooBig = err?.code === 'LIMIT_FILE_SIZE';
  res.status(tooBig ? 413 : 400).json({ error: err?.message || 'Request failed' });
});

app.listen(PORT, () => {
  console.log(`Beanery API on http://localhost:${PORT}`);
  if (googleConfigured()) {
    console.log('Sign-in: Google');
    if (googleAllowlistEmpty()) {
      console.log('  WARNING: ADMIN_EMAILS is empty, so nobody can sign in yet.');
    }
  } else {
    console.log('Sign-in: username and password (set GOOGLE_CLIENT_ID for Google)');
    if (!getAdmin()) {
      console.log('  No admin account yet - create one with: npm run admin:password');
    }
  }
});
