// Stockage : le coffre chiffré est dans storage.local ; la clé déverrouillée
// vit dans storage.session (mémoire) et, si « rester déverrouillé » est actif, dans storage.local (clé `keptKey`).
import * as V from './vault.js';

// stayUnlocked : le coffre reste ouvert jusqu'au bouton « Verrouiller », même après un redémarrage du navigateur.
// La clé est alors recopiée dans le stockage local (sur disque) ; sinon elle ne vit qu'en mémoire.
const DEFAULTS = { autolockMin: 15, stayUnlocked: true, neverSave: [] };

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

async function touch() {
  const s = await getSettings();
  if (!s.stayUnlocked && s.autolockMin > 0) chrome.alarms.create('autolock', { delayInMinutes: s.autolockMin });
  else chrome.alarms.clear('autolock');
}

async function readKey() {
  const { key } = await chrome.storage.session.get('key');
  if (key) return key;
  if (!(await getSettings()).stayUnlocked) return null;
  const { keptKey } = await chrome.storage.local.get('keptKey');
  if (!keptKey) return null;
  await chrome.storage.session.set({ key: keptKey });
  return keptKey;
}

async function writeKey(jwk) {
  await chrome.storage.session.set({ key: jwk });
  if ((await getSettings()).stayUnlocked) await chrome.storage.local.set({ keptKey: jwk });
  else await chrome.storage.local.remove('keptKey');
  await touch();
}

export async function setSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: s });
  const { key } = await chrome.storage.session.get('key');
  if ('stayUnlocked' in patch) {
    if (key && s.stayUnlocked) await chrome.storage.local.set({ keptKey: key });
    else if (!s.stayUnlocked) await chrome.storage.local.remove('keptKey');
  }
  if (key) await touch();
  return s;
}

export async function getState() {
  const { vault } = await chrome.storage.local.get('vault');
  const key = await readKey();
  return { exists: !!vault, unlocked: !!(vault && key) };
}

async function persist(key, kdf, entries) {
  await chrome.storage.local.set({ vault: await V.seal(key, kdf, { entries }) });
}

export async function createVault(master) {
  const kdf = V.newKdf();
  const key = await V.deriveKey(master, V.unb64(kdf.salt), kdf.iter);
  await persist(key, kdf, []);
  await writeKey(await V.exportKey(key));
}

async function openWith(master) {
  const { vault } = await chrome.storage.local.get('vault');
  if (!vault) throw new Error('Aucun coffre.');
  const key = await V.deriveKey(master, V.unb64(vault.kdf.salt), vault.kdf.iter);
  try {
    return { key, data: await V.unseal(key, vault) };
  } catch {
    throw new Error('Mot de passe maître incorrect.');
  }
}

export async function unlock(master) {
  const { key } = await openWith(master);
  await writeKey(await V.exportKey(key));
}

export async function lock() {
  await chrome.storage.session.remove(['key']);
  await chrome.storage.local.remove('keptKey');
  await chrome.alarms.clear('autolock');
}

export async function changeMaster(oldMaster, newMaster) {
  let data;
  try { ({ data } = await openWith(oldMaster)); } catch { throw new Error('Mot de passe maître actuel incorrect.'); }
  const kdf = V.newKdf();
  const key = await V.deriveKey(newMaster, V.unb64(kdf.salt), kdf.iter);
  await persist(key, kdf, data.entries);
  await writeKey(await V.exportKey(key));
}

export async function loadEntries() {
  const { vault } = await chrome.storage.local.get('vault');
  const jwk = await readKey();
  if (!vault || !jwk) throw new Error('locked');
  const data = await V.unseal(await V.importKey(jwk), vault);
  await touch();
  return data.entries;
}

export async function saveEntries(entries) {
  const { vault } = await chrome.storage.local.get('vault');
  const jwk = await readKey();
  if (!vault || !jwk) throw new Error('locked');
  await persist(await V.importKey(jwk), vault.kdf, entries);
  await touch();
}

// Sauvegarde = le coffre déjà chiffré, tel quel (rien de lisible n'est exporté).
export async function exportBackup() {
  const { vault } = await chrome.storage.local.get('vault');
  if (!vault) throw new Error('Aucun coffre.');
  return JSON.stringify(vault);
}

// Lit une sauvegarde avec SON mot de passe maître (peut différer de l'actuel) et renvoie ses entrées.
export async function readBackup(text, backupMaster) {
  const blob = V.parseBackup(text);
  const key = await V.deriveKey(backupMaster, V.unb64(blob.kdf.salt), blob.kdf.iter);
  let data;
  try { data = await V.unseal(key, blob); } catch { throw new Error('Mot de passe de la sauvegarde incorrect (ou fichier altéré).'); }
  if (!Array.isArray(data.entries)) throw new Error('Sauvegarde invalide.');
  return data.entries.filter((e) => e && typeof e.password === 'string' && typeof e.id === 'string');
}
