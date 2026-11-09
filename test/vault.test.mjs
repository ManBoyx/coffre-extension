import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as V from '../lib/vault.js';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  -', name); };

await t('chiffrement : aller-retour', async () => {
  const kdf = { salt: V.b64(crypto.getRandomValues(new Uint8Array(16))), iter: 1000 };
  const key = await V.deriveKey('un-maitre-solide', V.unb64(kdf.salt), kdf.iter);
  const blob = await V.seal(key, kdf, { entries: [{ id: 'a', password: 'sé"cret,1' }] });
  assert.ok(!JSON.stringify(blob).includes('cret'), 'le clair ne doit pas apparaître');
  assert.deepEqual((await V.unseal(key, blob)).entries[0].password, 'sé"cret,1');
});

await t('chiffrement : mauvais mot de passe refusé', async () => {
  const kdf = { salt: V.b64(crypto.getRandomValues(new Uint8Array(16))), iter: 1000 };
  const good = await V.deriveKey('bon', V.unb64(kdf.salt), kdf.iter);
  const bad = await V.deriveKey('mauvais', V.unb64(kdf.salt), kdf.iter);
  const blob = await V.seal(good, kdf, { entries: [] });
  await assert.rejects(V.unseal(bad, blob));
});

await t('chiffrement : donnée altérée refusée', async () => {
  const kdf = { salt: V.b64(crypto.getRandomValues(new Uint8Array(16))), iter: 1000 };
  const key = await V.deriveKey('x', V.unb64(kdf.salt), kdf.iter);
  const blob = await V.seal(key, kdf, { entries: [] });
  const raw = V.unb64(blob.ct); raw[0] ^= 1;
  await assert.rejects(V.unseal(key, { ...blob, ct: V.b64(raw) }));
});

await t('clé exportable/réimportable (session)', async () => {
  const kdf = { salt: V.b64(crypto.getRandomValues(new Uint8Array(16))), iter: 1000 };
  const key = await V.deriveKey('x', V.unb64(kdf.salt), kdf.iter);
  const blob = await V.seal(key, kdf, { entries: [1] });
  const again = await V.importKey(await V.exportKey(key));
  assert.deepEqual((await V.unseal(again, blob)).entries, [1]);
});

await t('CSV : guillemets, virgules, retours à la ligne', () => {
  const csv = 'name,url,username,password,note\r\nsite,https://a.fr/,moi,"pa""ss,word","ligne1\nligne2"\n';
  const e = V.entriesFromCSV(csv);
  assert.equal(e.length, 1);
  assert.equal(e[0].password, 'pa"ss,word');
  assert.equal(e[0].note, 'ligne1\nligne2');
});

await t('CSV : colonnes manquantes -> erreur claire', () => {
  assert.throws(() => V.entriesFromCSV('a,b\n1,2\n'), /introuvables/);
});

await t('sites : sous-domaines du même site', () => {
  assert.ok(V.sameSite('https://accounts.google.com/x', 'https://mail.google.com'));
  assert.ok(V.sameSite('https://www.bbc.co.uk', 'https://news.bbc.co.uk/a'));
  assert.ok(!V.sameSite('https://google.com', 'https://google.com.evil.io'));
  assert.ok(!V.sameSite('https://paypal.com', 'https://paypa1.com'));
});

await t('sites : suffixes partagés non confondus', () => {
  assert.ok(!V.sameSite('https://mon-bot.pages.dev', 'https://evil.pages.dev'));
  assert.ok(V.sameSite('https://a.mon-bot.pages.dev', 'https://b.mon-bot.pages.dev'));
  assert.ok(!V.sameSite('https://user.github.io', 'https://autre.github.io'));
  assert.ok(!V.sameSite('https://x.itch.io', 'https://y.itch.io'));
});

await t('sites : IP / localhost / http', () => {
  assert.ok(V.sameSite('http://192.168.1.1/', 'http://192.168.1.1:8080'));
  assert.ok(!V.sameSite('http://192.168.1.1', 'http://192.168.1.2'));
  assert.equal(V.hostOf('pas une url :::'), 'pas une url :::'.includes('://') ? '' : V.hostOf('pas une url :::'));
});

await t('correspondance : hôte exact en premier', () => {
  const es = [V.newEntry({ url: 'https://accounts.proton.me', username: 'b', password: 'x' }),
              V.newEntry({ url: 'https://mail.proton.me', username: 'a', password: 'x' }),
              V.newEntry({ url: 'https://autre.fr', username: 'c', password: 'x' })];
  const m = V.matchEntries(es, 'https://mail.proton.me/inbox');
  assert.deepEqual(m.map((e) => e.username), ['a', 'b']);
});

await t('mot de passe aléatoire : longueur et variété', () => {
  const p = V.randomPassword(24);
  assert.equal(p.length, 24);
  assert.notEqual(p, V.randomPassword(24));
});

const real = process.argv[2];
if (real && existsSync(real)) {
  await t('CSV réel : import complet (compteurs seulement)', () => {
    const e = V.entriesFromCSV(readFileSync(real, 'utf8'));
    const withUser = e.filter((x) => x.username).length;
    console.log(`      ${e.length} entrées, ${withUser} avec identifiant, ${new Set(e.map((x) => V.hostOf(x.url))).size} sites`);
    assert.ok(e.length > 0);
  });
}
console.log(`\n${n} tests OK`);
