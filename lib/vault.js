// Coeur du coffre : chiffrement, lecture CSV, correspondance de sites.
// Aucune dépendance au navigateur : testable avec Node (voir test/vault.test.mjs).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITER = 600000;

export function b64(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (const c of a) s += String.fromCharCode(c);
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------- chiffrement
export async function deriveKey(master, salt, iter = KDF_ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(master), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export function newKdf() {
  return { salt: b64(crypto.getRandomValues(new Uint8Array(16))), iter: KDF_ITER };
}

export async function seal(key, kdf, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, kdf, iv: b64(iv), ct: b64(ct) };
}

export async function unseal(key, blob) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(dec.decode(pt));
}

export const exportKey = (key) => crypto.subtle.exportKey('jwk', key);
export const importKey = (jwk) => crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

// ---------------------------------------------------------------- entrées
export function newEntry(f) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: (f.name || '').trim(),
    url: (f.url || '').trim(),
    username: f.username || '',
    password: f.password || '',
    note: f.note || '',
    created: now,
    modified: now,
  };
}

// ---------------------------------------------------------------- CSV (RFC 4180)
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Accepte le format Chrome/Chromium (name,url,username,password,note) et des variantes courantes.
export function entriesFromCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iName = col('name', 'title'), iUrl = col('url', 'login_uri', 'website');
  const iUser = col('username', 'login_username', 'user'), iPass = col('password', 'login_password');
  const iNote = col('note', 'notes');
  if (iUrl < 0 || iPass < 0) throw new Error('Colonnes « url » et « password » introuvables dans ce CSV.');
  const get = (r, i) => (i >= 0 && r[i] !== undefined ? r[i] : '');
  return rows.slice(1)
    .map((r) => newEntry({ name: get(r, iName), url: get(r, iUrl), username: get(r, iUser), password: get(r, iPass), note: get(r, iNote) }))
    .filter((e) => e.password && (e.url || e.name));
}

// ---------------------------------------------------------------- sites
// Suffixes où chaque sous-domaine est un site différent : on ne doit pas les confondre.
const PRIVATE_SUFFIXES = ['github.io', 'pages.dev', 'vercel.app', 'netlify.app', 'workers.dev', 'herokuapp.com', 'blogspot.com',
  'web.app', 'firebaseapp.com', 'itch.io', 'glitch.me', 'repl.co', 'onrender.com', 'ngrok.io', 'fly.dev', 'surge.sh', 'wixsite.com'];
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

export function hostOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url.includes('://') ? url : 'https://' + url);
    return u.hostname.toLowerCase();
  } catch { return ''; }
}

export function baseDomain(host) {
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host;
  const labels = host.split('.');
  for (const s of PRIVATE_SUFFIXES) {
    if (host === s) return host;
    if (host.endsWith('.' + s)) return labels.slice(-(s.split('.').length + 1)).join('.');
  }
  const n = labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join('.');
}

export function sameSite(urlA, urlB) {
  const a = hostOf(urlA), b = hostOf(urlB);
  return !!a && !!b && baseDomain(a) === baseDomain(b);
}

export function matchEntries(entries, pageUrl) {
  const ph = hostOf(pageUrl);
  return entries
    .filter((e) => sameSite(e.url, pageUrl))
    .sort((x, y) => (hostOf(y.url) === ph) - (hostOf(x.url) === ph) || x.username.localeCompare(y.username));
}

// Fusionne des entrées entrantes dans les existantes sans créer de doublons exacts (site + identifiant + mot de passe).
export function mergeEntries(existing, incoming) {
  const key = (e) => `${hostOf(e.url)}|${e.username}|${e.password}`;
  const have = new Set(existing.map(key));
  const entries = [...existing];
  let added = 0, dup = 0;
  for (const e of incoming) {
    if (have.has(key(e))) { dup++; continue; }
    have.add(key(e)); entries.push(e); added++;
  }
  return { entries, added, dup };
}

// Vérifie qu'un fichier de sauvegarde a bien la forme attendue avant de dériver une clé (borne le coût du KDF).
export function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('Ce fichier n\'est pas une sauvegarde Coffre valide.'); }
  const ok = b && b.v === 1 && b.kdf && typeof b.kdf.salt === 'string' && Number.isInteger(b.kdf.iter)
    && b.kdf.iter >= 1000 && b.kdf.iter <= 5_000_000 && typeof b.iv === 'string' && typeof b.ct === 'string';
  if (!ok) throw new Error('Ce fichier n\'est pas une sauvegarde Coffre valide.');
  return { v: 1, kdf: { salt: b.kdf.salt, iter: b.kdf.iter }, iv: b.iv, ct: b.ct };
}

export function toCSV(entries) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return ['name,url,username,password,note', ...entries.map((e) => [e.name, e.url, e.username, e.password, e.note].map(q).join(','))].join('\r\n') + '\r\n';
}

export function randomPassword(len = 20) {
  const set = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+';
  const out = [];
  const lim = 256 - (256 % set.length);
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < lim && out.length < len) out.push(set[b % set.length]);
    }
  }
  return out.join('');
}
