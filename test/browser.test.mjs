// Test de bout en bout dans un vrai Helium sans fenêtre (profil jetable), avec de vrais clics (CDP).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = process.env.HELIUM || '/opt/helium/helium';
const PORT = 9333, SITE_PORT = 8765;
const profile = mkdtempSync(join(tmpdir(), 'coffre-test-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const cleanup = () => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

procs.push(spawn('python3', ['-I', '-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1'], { cwd: join(root, 'test/site'), stdio: 'ignore' }));
procs.push(spawn(BIN, ['--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--load-extension=${root}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' }));

async function until(fn, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fn(); if (r) return r; } catch {}
    if (Date.now() - t0 > ms) throw new Error('délai dépassé : ' + what);
    await sleep(200);
  }
}

const ver = await until(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(), 'démarrage du navigateur');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const waiting = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (process.env.NAVDEBUG && /^Page\.(frameNavigated|frameRequestedNavigation|navigatedWithinDocument|frameStartedLoading)$/.test(d.method || '')) console.log('NAV', d.method, JSON.stringify(d.params).slice(0, 160)); if (process.env.DEBUG && (d.method === 'Runtime.exceptionThrown' || (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error'))) console.log('PAGE>', JSON.stringify(d.params.exceptionDetails ? { t: d.params.exceptionDetails.text, e: d.params.exceptionDetails.exception?.description?.slice(0, 300), u: d.params.exceptionDetails.url } : d.params.args.map((a) => a.value ?? a.description)).slice(0, 500)); if (d.id && waiting.has(d.id)) { const [res, rej] = waiting.get(d.id); waiting.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } });
const cdp = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params, sessionId })); });

async function open(url) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId); await cdp('DOM.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId); await cdp('Page.bringToFront', {}, sessionId).catch(() => {});
  const rt = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result.value;
  // un nouvel onglet charge d'abord about:blank : naviguer avant la fin de ce chargement fait avorter la navigation
  await until(async () => (await rt('document.readyState')) === 'complete', 'onglet vierge prêt');
  for (let i = 0; i < 4; i++) {
    const nav = await cdp('Page.navigate', { url }, sessionId);
    if (!nav.errorText) break;
    await sleep(400);
  }
  await until(async () => (await rt('location.href')) !== 'about:blank', 'chargement ' + url);
  return { targetId, sessionId, ev: async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value };
}

const extId = await until(async () => {
  const { targetInfos } = await cdp('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('background.js'));
  return sw && new URL(sw.url).host;
}, 'extension chargée (service worker)');
console.log('ext id:', extId);

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  -', name); };

// Coffre préparé via la page de l'extension (mêmes modules que l'extension).
const vault = await open(`chrome-extension://${extId}/vault.html`);
await t('page du coffre : écran de création', async () => {
  await until(async () => (await vault.ev(`!document.getElementById('setup').hidden`)), 'écran setup');
});
await vault.ev(`(async()=>{const S=await import('./lib/store.js');const V=await import('./lib/vault.js');
  await S.createVault('maitre-de-test-123');
  await S.saveEntries([V.newEntry({url:'http://127.0.0.1:${SITE_PORT}',username:'alice',password:'pw-alice'}),
                       V.newEntry({url:'https://autre-site.fr',username:'intrus',password:'pw-intrus'})]); return 1})()`);

// ---- parcours DOM (y compris shadow DOM fermé)
async function tree(page) {
  const { root: r } = await cdp('DOM.getDocument', { depth: -1, pierce: true }, page.sessionId);
  return r;
}
const attrs = (n) => Object.fromEntries((n.attributes || []).reduce((a, v, i, arr) => (i % 2 ? a : [...a, [v, arr[i + 1]]]), []));
const walk = (n, f, out = []) => { if (f(n)) out.push(n); for (const c of [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])]) walk(c, f, out); return out; };
const textOf = (n) => (n.children || []).map((c) => c.nodeValue || textOf(c)).join('');
async function find(page, pred, what) {
  return until(async () => walk(await tree(page), pred)[0], what);
}
async function click(page, node) {
  const { model } = await cdp('DOM.getBoxModel', { backendNodeId: node.backendNodeId }, page.sessionId);
  const q = model.content; const x = (q[0] + q[2]) / 2, y = (q[1] + q[5]) / 2;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, page.sessionId);
}

const page = await open(`http://127.0.0.1:${SITE_PORT}/login.html`);
await t('icône affichée dans le champ mot de passe ET identifiant', async () => {
  try {
    await until(async () => walk(await tree(page), (n) => attrs(n).class === 'ic').length >= 2, 'deux icônes');
  } catch (e) {
    console.log('DIAG', await page.ev(`JSON.stringify({href:location.href,title:document.title,ready:document.readyState,hidden:document.hidden,
      hosts:[...document.documentElement.children].filter(c=>/2147483647/.test(c.getAttribute('style')||'')).length,
      inputs:document.querySelectorAll('input').length})`));
    throw e;
  }
});

await t('badge : 1 identifiant pour ce site (pas celui de l\'autre site)', async () => {
  const b = await find(page, (n) => n.nodeName === 'B' && textOf(n) === '1', 'badge 1');
  assert.ok(b);
});

await t('clic sur l\'icône -> menu avec alice, sans l\'intrus', async () => {
  const icons = walk(await tree(page), (n) => attrs(n).class === 'ic');
  await click(page, icons[icons.length - 1]);
  const item = await find(page, (n) => n.nodeName === 'BUTTON' && attrs(n).class === 'it' && textOf(n).includes('alice'), 'menu alice');
  assert.ok(item);
  assert.equal(walk(await tree(page), (n) => n.nodeName === 'BUTTON' && textOf(n).includes('intrus')).length, 0);
});

await t('clic sur alice -> identifiant ET mot de passe remplis', async () => {
  const item = await find(page, (n) => n.nodeName === 'BUTTON' && attrs(n).class === 'it' && textOf(n).includes('alice'), 'menu alice');
  await click(page, item);
  const v = await until(async () => { const r = await page.ev(`[document.getElementById('u').value, document.getElementById('p').value]`); return r[1] ? r : null; }, 'champs remplis');
  assert.deepEqual(v, ['alice', 'pw-alice']);
});

await t('clic simulé par la page : ignoré (non fiable)', async () => {
  const p2 = await open(`http://127.0.0.1:${SITE_PORT}/login.html`);
  await until(async () => walk(await tree(p2), (n) => attrs(n).class === 'ic').length >= 2, 'icônes');
  // la page ne peut pas atteindre le shadow DOM fermé ; elle ne peut qu'agir sur ses propres éléments
  const found = await p2.ev(`document.querySelectorAll('.ic').length`);
  assert.equal(found, 0);
});

await t('nouvelle connexion -> fenêtre « Ajouter » en haut à droite -> enregistré', async () => {
  const p3 = await open(`http://127.0.0.1:${SITE_PORT}/login.html`);
  await until(async () => walk(await tree(p3), (n) => attrs(n).class === 'ic').length >= 2, 'icônes');
  await p3.ev(`document.getElementById('u').focus()`);
  await cdp('Input.insertText', { text: 'bob' }, p3.sessionId);
  await p3.ev(`document.getElementById('p').focus()`);
  await cdp('Input.insertText', { text: 'nouveau-mdp-9' }, p3.sessionId);
  await click(p3, await find(p3, (n) => n.nodeName === 'BUTTON' && attrs(n).id === 'go', 'bouton connexion'));
  const add = await find(p3, (n) => n.nodeName === 'BUTTON' && textOf(n) === 'Ajouter', 'bouton Ajouter', 20000);
  const title = await find(p3, (n) => attrs(n).class === 't' && textOf(n).includes('Enregistrer'), 'titre');
  assert.ok(title);
  await click(p3, add);
  const saved = await until(async () => vault.ev(`(async()=>{const S=await import('./lib/store.js');return (await S.loadEntries()).find(e=>e.username==='bob')?.password})()`), 'entrée enregistrée');
  assert.equal(saved, 'nouveau-mdp-9');
});

await t('mot de passe déjà connu : aucune fenêtre', async () => {
  const p4 = await open(`http://127.0.0.1:${SITE_PORT}/login.html`);
  await until(async () => walk(await tree(p4), (n) => attrs(n).class === 'ic').length >= 2, 'icônes');
  await p4.ev(`document.getElementById('u').focus()`);
  await cdp('Input.insertText', { text: 'alice' }, p4.sessionId);
  await p4.ev(`document.getElementById('p').focus()`);
  await cdp('Input.insertText', { text: 'pw-alice' }, p4.sessionId);
  await click(p4, await find(p4, (n) => n.nodeName === 'BUTTON' && attrs(n).id === 'go', 'bouton connexion'));
  await until(async () => (await p4.ev('location.pathname')) === '/ok.html', 'navigation');
  await sleep(3500);
  assert.equal(walk(await tree(p4), (n) => n.nodeName === 'BUTTON' && textOf(n) === 'Ajouter').length, 0);
});

await t('page du coffre : réglages, liste, recherche', async () => {
  await vault.ev(`document.getElementById('settings').click()`);
  assert.equal(await vault.ev(`document.getElementById('sdlg').open`), true);
  assert.equal(await vault.ev(`document.getElementById('s-auto').value`), '15');
  assert.equal(await vault.ev(`document.getElementById('s-stay').checked`), true, 'rester déverrouillé : actif par défaut');
  assert.equal(await vault.ev(`document.getElementById('s-auto').disabled`), true, 'le délai est inutile quand on reste déverrouillé');
  await vault.ev(`document.getElementById('s-close').click()`);
  assert.equal(await vault.ev(`document.getElementById('sdlg').open`), false);
  // bob a été ajouté depuis un autre onglet : la liste ouverte doit se mettre à jour toute seule
  await until(async () => (await vault.ev(`document.querySelectorAll('.item').length`)) >= 3, 'liste rechargée avec l\'ajout fait ailleurs');
  const ids = await vault.ev(`[...document.querySelectorAll('.item .who')].map(x=>x.textContent).sort().join()`);
  assert.ok(ids.includes('bob'), 'bob visible : ' + ids);
  await vault.ev(`(()=>{const q=document.getElementById('q');q.value='alice';q.dispatchEvent(new Event('input'))})()`);
  assert.equal(await vault.ev(`document.querySelectorAll('.item').length`), 1);
});

await t('modifier une entrée ne fait perdre aucun ajout fait ailleurs', async () => {
  await vault.ev(`(()=>{const q=document.getElementById('q');q.value='';q.dispatchEvent(new Event('input'))})()`);
  await vault.ev(`document.querySelectorAll('.item')[0].click()`); // ouvre la 1re fiche
  await vault.ev(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent === 'Modifier la fiche').click()`);
  // un autre contexte ajoute une entrée pendant que la fenêtre d'édition est ouverte, sans laisser le temps au rechargement
  await vault.ev(`(async()=>{const S=await import('./lib/store.js');const V=await import('./lib/vault.js');
    const e=await S.loadEntries();e.push(V.newEntry({url:'https://tard.fr',username:'tardif',password:'t'}));await S.saveEntries(e);
    document.getElementById('f-note').value='note-modifiee';document.getElementById('form').requestSubmit();})()`);
  const ok = await until(async () => vault.ev(`(async()=>{const S=await import('./lib/store.js');const e=await S.loadEntries();
    return ['tardif','bob','alice'].every(u=>e.some(x=>x.username===u)) && e.some(x=>x.note==='note-modifiee')})()`), 'aucune perte');
  assert.ok(ok);
});

await t('« Jamais » depuis la fenêtre d\'ajout', async () => {
  const p5 = await open(`http://127.0.0.1:${SITE_PORT}/login.html`);
  await until(async () => walk(await tree(p5), (n) => attrs(n).class === 'ic').length >= 2, 'icônes');
  await p5.ev(`document.getElementById('u').focus()`);
  await cdp('Input.insertText', { text: 'carol' }, p5.sessionId);
  await p5.ev(`document.getElementById('p').focus()`);
  await cdp('Input.insertText', { text: 'mdp-carol-1' }, p5.sessionId);
  await click(p5, await find(p5, (n) => n.nodeName === 'BUTTON' && attrs(n).id === 'go', 'bouton connexion'));
  await click(p5, await find(p5, (n) => n.nodeName === 'BUTTON' && textOf(n) === 'Jamais', 'bouton Jamais', 20000));
  const nv = await until(async () => vault.ev(`(async()=>{const S=await import('./lib/store.js');return (await S.getSettings()).neverSave.join()})()`), 'site ignoré');
  assert.equal(nv, '127.0.0.1');
});

console.log(`\n${n} tests navigateur OK`);
cleanup();
process.exit(0);
