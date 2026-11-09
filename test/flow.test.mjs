// Simule l'API chrome.* pour tester store.js + background.js de bout en bout.
import assert from 'node:assert/strict';

const mem = () => {
  const d = {};
  return {
    d,
    async get(k) { const keys = typeof k === 'string' ? [k] : k; return Object.fromEntries(keys.filter((x) => x in d).map((x) => [x, structuredClone(d[x])])); },
    async set(o) { Object.assign(d, structuredClone(o)); },
    async remove(k) { for (const x of [].concat(k)) delete d[x]; },
  };
};
const local = mem(), session = mem();
const alarmLog = [];
let onMessage = null;
globalThis.chrome = {
  runtime: { id: 'ext', getURL: (p) => p, onMessage: { addListener: (f) => { onMessage = f; } } },
  storage: { local, session },
  alarms: { create(n, o) { alarmLog.push(['create', n, o.delayInMinutes]); }, clear(n) { alarmLog.push(['clear', n]); }, onAlarm: { addListener() {} } },
  action: { onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  tabs: { create() {}, query: async () => [], sendMessage: async () => {} },
};

const S = await import('../lib/store.js');
const V = await import('../lib/vault.js');
await import('../background.js');

const call = (msg, tabUrl, tabId = 1, id = 'ext') => new Promise((res) => {
  const keep = onMessage(msg, { id, tab: tabUrl ? { id: tabId, url: tabUrl } : undefined }, res);
  if (!keep) res({ ignored: true });
});
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  -', name); };

await t('coffre inexistant puis création', async () => {
  assert.deepEqual(await S.getState(), { exists: false, unlocked: false });
  await S.createVault('mot-de-passe-maitre-12+');
  assert.deepEqual(await S.getState(), { exists: true, unlocked: true });
});

await t('rien de lisible dans storage.local', async () => {
  await S.saveEntries([V.newEntry({ url: 'https://a.fr', username: 'moi', password: 'SECRET-UNIQUE-123' })]);
  assert.ok(!JSON.stringify(local.d).includes('SECRET-UNIQUE-123'));
  assert.ok(!JSON.stringify(local.d).includes('moi'));
});

await t('verrouillage / mauvais mot de passe / déverrouillage', async () => {
  await S.lock();
  assert.equal((await S.getState()).unlocked, false);
  await assert.rejects(S.unlock('faux'), /incorrect/);
  await S.unlock('mot-de-passe-maitre-12+');
  assert.equal((await S.loadEntries())[0].password, 'SECRET-UNIQUE-123');
});

const entries = [
  V.newEntry({ url: 'https://mail.proton.me', username: 'alice', password: 'pw-proton' }),
  V.newEntry({ url: 'https://github.com', username: 'alice-gh', password: 'pw-gh' }),
];
await S.saveEntries(entries);

await t('match : seulement les entrées du site, jamais de mot de passe', async () => {
  const r = await call({ type: 'match' }, 'https://account.proton.me/login');
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].username, 'alice');
  assert.ok(!JSON.stringify(r).includes('pw-proton'));
});

await t('cred : mot de passe fourni au bon site', async () => {
  const r = await call({ type: 'cred', id: entries[0].id }, 'https://mail.proton.me/');
  assert.equal(r.password, 'pw-proton');
});

await t('cred : REFUSÉ pour un autre site (hameçonnage)', async () => {
  const r = await call({ type: 'cred', id: entries[0].id }, 'https://proton.me.evil.io/login');
  assert.ok(r.error, 'doit être refusé');
  assert.ok(!JSON.stringify(r).includes('pw-proton'));
  const r2 = await call({ type: 'cred', id: entries[1].id }, 'https://mail.proton.me/');
  assert.ok(r2.error);
});

await t('messages étrangers ignorés', async () => {
  assert.equal((await call({ type: 'match' }, 'https://mail.proton.me', 1, 'autre-extension')).ignored, true);
  assert.equal((await call({ type: 'match' }, null)).ignored, true);
});

await t('verrouillé : aucune donnée servie', async () => {
  await S.lock();
  const r = await call({ type: 'cred', id: entries[0].id }, 'https://mail.proton.me/');
  assert.deepEqual(r, { locked: true });
  await S.unlock('mot-de-passe-maitre-12+');
});

await t('capture -> pending -> commit : nouveau compte', async () => {
  await call({ type: 'capture', username: 'bob', password: 'nouveau-mdp' }, 'https://exemple.org/login', 7);
  const p = await call({ type: 'pending' }, 'https://exemple.org/home', 7);
  assert.deepEqual([p.status, p.username, p.host], ['new', 'bob', 'exemple.org']);
  await call({ type: 'commit' }, 'https://exemple.org/home', 7);
  const saved = (await S.loadEntries()).find((e) => e.username === 'bob');
  assert.equal(saved.password, 'nouveau-mdp');
  assert.equal(saved.url, 'https://exemple.org');
});

await t('capture : mot de passe changé -> update ; identique -> rien', async () => {
  await call({ type: 'capture', username: 'bob', password: 'autre-mdp' }, 'https://exemple.org/login', 8);
  assert.equal((await call({ type: 'pending' }, 'https://exemple.org/', 8)).status, 'update');
  await call({ type: 'commit' }, 'https://exemple.org/', 8);
  assert.equal((await S.loadEntries()).filter((e) => e.username === 'bob').length, 1);
  await call({ type: 'capture', username: 'bob', password: 'autre-mdp' }, 'https://exemple.org/login', 9);
  assert.deepEqual(await call({ type: 'pending' }, 'https://exemple.org/', 9), {});
});

await t('pending d\'un autre site non proposé', async () => {
  await call({ type: 'capture', username: 'x', password: 'y' }, 'https://exemple.org/login', 10);
  assert.deepEqual(await call({ type: 'pending' }, 'https://autre-site.com/', 10), {});
});

await t('« Jamais » : le site n\'est plus proposé, et la liste est modifiable', async () => {
  await call({ type: 'capture', username: 'zed', password: 'zz' }, 'https://sub.jamais.fr/login', 20);
  assert.equal((await call({ type: 'pending' }, 'https://jamais.fr/', 20)).status, 'new');
  await call({ type: 'never' }, 'https://sub.jamais.fr/login', 20);
  assert.deepEqual(await call({ type: 'pending' }, 'https://jamais.fr/', 20), {});
  assert.deepEqual((await S.getSettings()).neverSave, ['jamais.fr']);
  assert.equal((await call({ type: 'capture', username: 'a', password: 'b' }, 'https://www.jamais.fr/', 21)).skipped, true);
  await S.setSettings({ neverSave: [] });
  assert.equal((await call({ type: 'capture', username: 'a', password: 'b' }, 'https://www.jamais.fr/', 21)).skipped, undefined);
});

await t('délai de verrouillage réglable quand « rester déverrouillé » est désactivé', async () => {
  alarmLog.length = 0;
  await S.setSettings({ stayUnlocked: false });
  assert.equal((await local.get('keptKey')).keptKey, undefined);
  await S.setSettings({ autolockMin: 5 });
  assert.deepEqual(alarmLog.at(-1), ['create', 'autolock', 5]);
  await S.setSettings({ autolockMin: 0 });
  assert.deepEqual(alarmLog.at(-1), ['clear', 'autolock']);
  await S.setSettings({ autolockMin: 15, stayUnlocked: true });
  assert.deepEqual(alarmLog.at(-1), ['clear', 'autolock']);
});

await t('rester déverrouillé : survit à un redémarrage du navigateur, jusqu\'au verrouillage manuel', async () => {
  await S.setSettings({ stayUnlocked: true });
  assert.ok((await local.get('keptKey')).keptKey, 'la clé doit être gardée sur disque');
  for (const k of Object.keys(session.d)) delete session.d[k]; // redémarrage : la mémoire de session est vidée
  assert.equal((await S.getState()).unlocked, true);
  assert.ok((await session.get('key')).key, 'la clé est remise en session');
  assert.ok((await S.loadEntries()).length > 0);
  await S.lock();
  assert.equal((await local.get('keptKey')).keptKey, undefined, 'verrouiller efface la clé du disque');
  assert.equal((await S.getState()).unlocked, false);
  await S.unlock('mot-de-passe-maitre-12+');
  assert.equal((await S.getState()).unlocked, true);
});

await t('désactiver « rester déverrouillé » retire la clé du disque et un redémarrage verrouille', async () => {
  await S.setSettings({ stayUnlocked: false });
  assert.equal((await local.get('keptKey')).keptKey, undefined);
  for (const k of Object.keys(session.d)) delete session.d[k];
  assert.equal((await S.getState()).unlocked, false);
  await S.setSettings({ stayUnlocked: true });
  await S.unlock('mot-de-passe-maitre-12+');
});

await t('changement du mot de passe maître', async () => {
  const before = await S.loadEntries();
  await assert.rejects(S.changeMaster('faux-mot-de-passe', 'nouveau-maitre-12+'), /actuel incorrect/);
  await S.changeMaster('mot-de-passe-maitre-12+', 'nouveau-maitre-12+');
  assert.deepEqual((await S.loadEntries()).map((e) => e.id), before.map((e) => e.id));
  await S.lock();
  await assert.rejects(S.unlock('mot-de-passe-maitre-12+'), /incorrect/);
  await S.unlock('nouveau-maitre-12+');
  assert.equal((await S.loadEntries()).length, before.length);
});

await t('sauvegarde chiffrée : rien de lisible, restauration avec son propre mot de passe', async () => {
  const backup = await S.exportBackup();
  assert.ok(!backup.includes('pw-proton') && !backup.includes('alice'));
  const mine = await S.loadEntries();
  const restored = await S.readBackup(backup, 'nouveau-maitre-12+');
  assert.equal(restored.length, mine.length);
  await assert.rejects(S.readBackup(backup, 'mauvais'), /incorrect/);
  // restauration dans un coffre vide protégé par un autre maître : fusion sans doublon
  const { mergeEntries } = V;
  assert.equal(mergeEntries(mine, restored).added, 0);
  assert.equal(mergeEntries([], restored).added, mine.length);
});

await t('sauvegarde invalide ou piégée refusée avant tout calcul', async () => {
  await assert.rejects(S.readBackup('pas du json', 'x'), /valide/);
  await assert.rejects(S.readBackup(JSON.stringify({ v: 1, kdf: { salt: 'AA==', iter: 4_000_000_000 }, iv: 'AA==', ct: 'AA==' }), 'x'), /valide/);
  await assert.rejects(S.readBackup(JSON.stringify({ v: 2 }), 'x'), /valide/);
});

await t('export CSV : relu à l\'identique par l\'import', async () => {
  const mine = await S.loadEntries();
  const back = V.entriesFromCSV(V.toCSV(mine));
  const k = (e) => `${e.url}|${e.username}|${e.password}`;
  assert.deepEqual(back.map(k).sort(), mine.map(k).sort());
});

console.log(`\n${n} tests OK`);
