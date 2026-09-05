import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneDefaults } from '../shared/content-defaults.js';

/**
 * JSON-file persistence for content, the admin account and the upload index.
 *
 * Writes go to a temp file and are renamed into place, so an interrupted write
 * cannot leave a half-written data file behind. Reads are served from memory.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'content.json');

function emptyDb() {
  return { admin: null, content: cloneDefaults(), uploads: [] };
}

function ensureDirs() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let db = null;
let loadedMtimeMs = 0;

/** True when another process (e.g. `npm run admin:password`) rewrote the file. */
function changedOnDisk() {
  try {
    return fs.statSync(DATA_FILE).mtimeMs !== loadedMtimeMs;
  } catch {
    return true;
  }
}

export function load() {
  if (db && !changedOnDisk()) return db;
  ensureDirs();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db = { ...emptyDb(), ...parsed };
      loadedMtimeMs = fs.statSync(DATA_FILE).mtimeMs;
    } catch (err) {
      // A corrupt file must not take the site down: keep the bad copy for
      // inspection and carry on from defaults.
      const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
      fs.renameSync(DATA_FILE, backup);
      console.error(`content.json was unreadable (${err.message}); moved to ${backup}`);
      db = emptyDb();
      save();
    }
  } else {
    db = emptyDb();
    save();
  }
  return db;
}

export function save() {
  ensureDirs();
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  // Record our own write so it does not look like an external change.
  loadedMtimeMs = fs.statSync(DATA_FILE).mtimeMs;
}

export function getContent() {
  return load().content;
}

export function setContent(content) {
  load().content = content;
  save();
  return content;
}

export function getAdmin() {
  return load().admin;
}

export function setAdmin(admin) {
  load().admin = admin;
  save();
  return admin;
}

export function listUploads() {
  return load().uploads;
}

export function addUpload(entry) {
  load().uploads.unshift(entry);
  save();
  return entry;
}

export function removeUpload(id) {
  const data = load();
  const index = data.uploads.findIndex((u) => u.id === id);
  if (index === -1) return null;
  const [entry] = data.uploads.splice(index, 1);
  save();
  return entry;
}
