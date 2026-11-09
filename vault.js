import * as S from './lib/store.js';
import { entriesFromCSV, hostOf, mergeEntries, newEntry, randomPassword, toCSV } from './lib/vault.js';

const $ = (id) => document.getElementById(id);
const panels = ['setup', 'locked', 'app'];
const mobile = window.matchMedia('(max-width: 820px)');
let entries = [];
let editing = null;      // fiche en cours d'édition (null = nouvelle)
let selectedId = null;   // fiche ouverte dans le registre
let revealed = false;    // mot de passe affiché dans la fiche ouverte
let confirmDelete = false;
let msgTimer = 0;

function msg(text, err = false) {
  const m = $('msg');
  clearTimeout(msgTimer);
  m.textContent = text;
  m.className = err ? 'err' : '';
  if (text && !err) msgTimer = setTimeout(() => { if (m.textContent === text) m.textContent = ''; }, 8000);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const label = (e) => (e.name || '').trim() || hostOf(e.url) || e.url || 'Sans nom';
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const initial = (s) => {
  const c = s.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

async function route() {
  const st = await S.getState();
  const show = !st.exists ? 'setup' : st.unlocked ? 'app' : 'locked';
  for (const p of panels) $(p).hidden = p !== show;
  if (show === 'app') {
    $('ledger').setAttribute('aria-busy', 'true');
    try {
      entries = await S.loadEntries();
    } catch (e) {
      if (e.message === 'locked') return route();
      msg(`Impossible de lire le coffre : ${e.message}`, true);
      return;
    }
    $('ledger').removeAttribute('aria-busy');
    render();
    return;
  }
  entries = [];
  selectedId = null;
  const s = await S.getSettings();
  $('stay-unlock').checked = $('stay-setup').checked = s.stayUnlocked;
  (show === 'setup' ? $('m1') : $('mu')).focus();
}

// ---------------------------------------------------------------- registre
function filtered() {
  const q = $('q').value.trim().toLowerCase();
  return entries
    .filter((e) => !q || `${e.name} ${e.url} ${e.username}`.toLowerCase().includes(q))
    .sort((a, b) => label(a).localeCompare(label(b), 'fr', { sensitivity: 'base' }) || (a.username || '').localeCompare(b.username || ''));
}

function render() {
  const list = filtered();
  const q = $('q').value.trim();
  $('count').textContent = q
    ? `${list.length} sur ${plural(entries.length, 'fiche', 'fiches')}`
    : plural(entries.length, 'fiche', 'fiches');
  renderList(list, q);
  renderFolio();
}

function renderList(list, q) {
  const box = $('list');
  box.replaceChildren();
  if (!entries.length) {
    const e = el('div', 'empty');
    e.append(el('p', null, 'Le coffre est vide.'), el('p', null, 'Importe un fichier CSV exporté depuis ton navigateur, ou crée une première fiche.'));
    const a = el('div', 'actions');
    const imp = el('button', null, 'Importer un CSV'); imp.addEventListener('click', () => $('file').click());
    const add = el('button', 'primary', 'Nouvelle fiche'); add.addEventListener('click', () => edit(null));
    a.append(imp, add);
    e.append(a);
    box.append(e);
    return;
  }
  if (!list.length) {
    const e = el('div', 'empty');
    e.append(el('p', null, `Aucune fiche ne correspond à « ${q} ».`));
    const a = el('div', 'actions');
    const reset = el('button', null, 'Effacer la recherche');
    reset.addEventListener('click', () => { $('q').value = ''; render(); $('q').focus(); });
    a.append(reset);
    e.append(a);
    box.append(e);
    return;
  }
  const frag = document.createDocumentFragment();
  let letter = '', ul = null;
  for (const e of list) {
    const l = initial(label(e));
    if (l !== letter) {
      letter = l;
      frag.append(el('h2', 'letter', l));
      ul = el('ul');
      frag.append(ul);
    }
    const li = el('li');
    const b = el('button', 'item');
    b.type = 'button';
    b.dataset.id = e.id;
    b.setAttribute('aria-current', String(e.id === selectedId));
    b.append(el('span', 'site', label(e)), el('span', 'who', e.username || 'sans identifiant'));
    b.addEventListener('click', () => select(e.id));
    li.append(b);
    ul.append(li);
  }
  box.append(frag);
}

function select(id) {
  selectedId = id;
  revealed = false;
  confirmDelete = false;
  for (const b of $('list').querySelectorAll('.item')) b.setAttribute('aria-current', String(b.dataset.id === id));
  renderFolio();
  $('ledger').dataset.view = 'folio';
  if (mobile.matches) window.scrollTo({ top: 0 });
}

function showList() {
  $('ledger').dataset.view = 'list';
  const cur = $('list').querySelector('.item[aria-current=true]');
  (cur || $('q')).focus();
}

async function copy(text, what, clearAfter) {
  try {
    await navigator.clipboard.writeText(text);
    msg(clearAfter ? `${what} copié. Il sera effacé du presse-papiers dans 30 secondes.` : `${what} copié.`);
    if (clearAfter) setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
  } catch {
    msg('Copie refusée par le navigateur.', true);
  }
}

function row(term, value, cls, acts) {
  const r = el('div', 'row');
  r.append(el('dt', null, term));
  const dd = el('dd', cls, value);
  r.append(dd);
  const a = el('div', 'acts');
  if (acts) a.append(...acts);
  r.append(a);
  return { r, dd };
}
function plainBtn(text, fn, extra = '') {
  const b = el('button', `plain ${extra}`.trim(), text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function renderFolio() {
  const box = $('folio');
  box.replaceChildren();
  const e = entries.find((x) => x.id === selectedId);
  if (!e) {
    selectedId = null;
    const blank = el('div', 'blank');
    blank.append(el('h2', null, 'Aucune fiche ouverte'));
    blank.append(el('p', null, 'Choisis une fiche dans l\'index pour voir son identifiant et son mot de passe.'));
    const tips = el('ul');
    const t1 = el('li'); t1.append(kbd('/'), ' place le curseur dans la recherche.');
    const t2 = el('li'); t2.append(kbd('↓'), ' et ', kbd('↑'), ' parcourent l\'index.');
    const t3 = el('li'); t3.append('Sur un site, la clé qui apparaît dans le champ remplit sans autre action.');
    tips.append(t1, t2, t3);
    blank.append(tips);
    box.append(blank);
    return;
  }

  const back = el('button', 'back', 'Retour à l\'index');
  back.type = 'button';
  back.addEventListener('click', showList);
  box.append(back);

  const sheet = el('article', 'sheet');
  sheet.append(el('h2', null, label(e)));
  if (/^https?:\/\//i.test(e.url)) {
    const p = el('p', 'addr');
    const a = el('a', null, e.url);
    a.href = e.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    p.append(a);
    sheet.append(p);
  } else if (e.url) {
    sheet.append(el('p', 'addr muted', e.url));
  }

  const rows = el('dl', 'rows');
  rows.append(row('Identifiant', e.username || 'aucun', 'val' + (e.username ? '' : ' muted'),
    e.username ? [plainBtn('Copier', () => copy(e.username, 'Identifiant', false))] : null).r);
  const pw = row('Mot de passe', revealed ? e.password : '••••••••••••', 'val secret', null);
  pw.r.querySelector('.acts').append(
    plainBtn(revealed ? 'Masquer' : 'Afficher', () => { revealed = !revealed; renderFolio(); }),
    plainBtn('Copier', () => copy(e.password, 'Mot de passe', true)));
  rows.append(pw.r);
  if (e.note) rows.append(row('Note', e.note, 'note', null).r);
  sheet.append(rows);

  const dates = [e.created && `Ajoutée le ${fmtDate(e.created)}`, e.modified && e.modified !== e.created && `modifiée le ${fmtDate(e.modified)}`].filter(Boolean);
  if (dates.length) sheet.append(el('p', 'meta', dates.join(', ') + '.'));

  const acts = el('div', 'sheet-actions');
  if (confirmDelete) {
    const c = el('div', 'confirm');
    c.append(el('span', null, 'Supprimer définitivement cette fiche ?'));
    const yes = el('button', 'danger', 'Supprimer'); yes.type = 'button';
    yes.addEventListener('click', () => removeEntry(e.id));
    const no = el('button', null, 'Garder'); no.type = 'button';
    no.addEventListener('click', () => { confirmDelete = false; renderFolio(); });
    c.append(yes, no);
    acts.append(c);
  } else {
    const ed = el('button', null, 'Modifier la fiche'); ed.type = 'button';
    ed.addEventListener('click', () => edit(e));
    acts.append(ed, el('span', 'grow'), plainBtn('Supprimer', () => { confirmDelete = true; renderFolio(); }, 'danger'));
  }
  sheet.append(acts);
  box.append(sheet);
}
const kbd = (t) => el('kbd', null, t);

async function removeEntry(id) {
  entries = (await S.loadEntries()).filter((x) => x.id !== id);
  await S.saveEntries(entries);
  selectedId = null;
  confirmDelete = false;
  $('ledger').dataset.view = 'list';
  render();
  msg('Fiche supprimée.');
}

// ---------------------------------------------------------------- édition
function edit(e) {
  editing = e;
  $('dtitle').textContent = e ? 'Modifier la fiche' : 'Nouvelle fiche';
  $('f-name').value = e?.name || '';
  $('f-url').value = e?.url || '';
  $('f-user').value = e?.username || '';
  $('f-pass').value = e?.password || '';
  $('f-pass').type = 'password';
  $('f-show').textContent = 'Afficher';
  $('f-note').value = e?.note || '';
  $('dlg').showModal();
  $('f-name').focus();
}
$('f-show').addEventListener('click', () => {
  const p = $('f-pass'); const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('f-show').textContent = show ? 'Masquer' : 'Afficher';
});
$('f-gen').addEventListener('click', () => { $('f-pass').value = randomPassword(20); $('f-pass').type = 'text'; $('f-show').textContent = 'Masquer'; });
$('f-cancel').addEventListener('click', () => $('dlg').close());
$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = { name: $('f-name').value, url: $('f-url').value, username: $('f-user').value, password: $('f-pass').value, note: $('f-note').value };
  if (!f.password) return msg('Le mot de passe est vide.', true);
  // relecture juste avant d'écrire : le coffre a pu changer ailleurs pendant l'édition
  entries = await S.loadEntries();
  const cur = editing && entries.find((x) => x.id === editing.id);
  let saved;
  if (cur) { Object.assign(cur, f, { modified: Date.now() }); saved = cur; }
  else { saved = newEntry(f); entries.push(saved); }
  await S.saveEntries(entries);
  $('dlg').close();
  $('q').value = '';
  selectedId = saved.id; revealed = false; confirmDelete = false;
  render();
  $('ledger').dataset.view = 'folio';
  msg('Fiche enregistrée.');
  $('list').querySelector('.item[aria-current=true]')?.scrollIntoView({ block: 'nearest' });
});

// ---------------------------------------------------------------- portes
$('create').addEventListener('click', async () => {
  const a = $('m1').value, b = $('m2').value;
  if (a.length < 12) return msg('12 caractères minimum.', true);
  if (a !== b) return msg('Les deux mots de passe ne correspondent pas.', true);
  try {
    await S.setSettings({ stayUnlocked: $('stay-setup').checked });
    await S.createVault(a);
    $('m1').value = $('m2').value = '';
    msg('Coffre créé.');
    await route();
  } catch (e) { msg(e.message, true); }
});
$('m2').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('create').click(); });

async function doUnlock() {
  try {
    await S.setSettings({ stayUnlocked: $('stay-unlock').checked });
    await S.unlock($('mu').value);
    $('mu').value = '';
    msg('');
    await route();
  } catch (e) { msg(e.message, true); $('mu').select(); }
}
$('unlock').addEventListener('click', doUnlock);
$('mu').addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });

$('lock').addEventListener('click', async () => { await S.lock(); msg('Coffre verrouillé.'); route(); });

// ---------------------------------------------------------------- recherche, clavier, import
$('q').addEventListener('input', render);
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); $('list').querySelector('.item')?.focus(); }
  if (e.key === 'Escape' && $('q').value) { $('q').value = ''; render(); }
});
$('list').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...$('list').querySelectorAll('.item')];
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  if (e.key === 'ArrowUp' && i === 0) return $('q').focus();
  items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || $('app').hidden) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  e.preventDefault();
  if (mobile.matches) $('ledger').dataset.view = 'list';
  $('q').focus();
});

$('add').addEventListener('click', () => edit(null));
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  $('file').value = '';
  if (!f) return;
  try {
    const incoming = entriesFromCSV(await f.text());
    const { entries: merged, added, dup } = mergeEntries(await S.loadEntries(), incoming);
    entries = merged;
    await S.saveEntries(entries);
    render();
    msg(`${plural(added, 'fiche importée', 'fiches importées')}` + (dup ? `, ${plural(dup, 'doublon ignoré', 'doublons ignorés')}` : '')
      + '. Supprime maintenant le fichier CSV : il contient tes mots de passe en clair.');
  } catch (e) { msg(e.message, true); }
});

// ---------------------------------------------------------------- réglages
function smsg(text, err = false) {
  const m = $('s-msg');
  m.textContent = text;
  m.className = err ? 'err' : '';
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const syncAuto = () => { $('s-auto').disabled = $('s-stay').checked; };

async function openSettings() {
  const s = await S.getSettings();
  $('s-stay').checked = s.stayUnlocked;
  $('s-auto').value = String(s.autolockMin);
  syncAuto();
  $('s-never').textContent = s.neverSave.length ? s.neverSave.join(', ') : 'Aucun site n\'est ignoré.';
  $('s-never-reset').hidden = !s.neverSave.length;
  for (const id of ['s-old', 's-new', 's-new2', 's-rpass']) $(id).value = '';
  resetCsvButton();
  smsg('');
  $('sdlg').showModal();
}
$('settings').addEventListener('click', openSettings);
$('s-close').addEventListener('click', () => $('sdlg').close());
$('s-stay').addEventListener('change', async () => {
  syncAuto();
  await S.setSettings({ stayUnlocked: $('s-stay').checked });
  smsg($('s-stay').checked ? 'Le coffre restera déverrouillé jusqu\'à ce que tu le verrouilles.' : 'Le coffre se verrouillera à la fermeture du navigateur ou après le délai choisi.');
});
$('s-auto').addEventListener('change', async () => { await S.setSettings({ autolockMin: Number($('s-auto').value) }); smsg('Délai enregistré.'); });

$('s-change').addEventListener('click', async () => {
  const o = $('s-old').value, a = $('s-new').value, b = $('s-new2').value;
  if (a.length < 12) return smsg('Le nouveau mot de passe doit faire 12 caractères minimum.', true);
  if (a !== b) return smsg('Les deux nouveaux mots de passe ne correspondent pas.', true);
  try {
    await S.changeMaster(o, a);
    for (const id of ['s-old', 's-new', 's-new2']) $(id).value = '';
    smsg('Mot de passe maître changé. Les anciennes sauvegardes restent lisibles avec l\'ancien.');
  } catch (e) { smsg(e.message, true); }
});

$('s-export').addEventListener('click', async () => {
  try {
    const d = new Date().toISOString().slice(0, 10);
    download(`coffre-sauvegarde-${d}.json`, await S.exportBackup(), 'application/json');
    smsg('Sauvegarde chiffrée téléchargée. Garde-la hors de cet ordinateur.');
  } catch (e) { smsg(e.message, true); }
});

$('s-restore').addEventListener('click', () => {
  if (!$('s-rpass').value) return smsg('Saisis d\'abord le mot de passe maître de la sauvegarde.', true);
  $('s-rfile').click();
});
$('s-rfile').addEventListener('change', async () => {
  const f = $('s-rfile').files[0];
  $('s-rfile').value = '';
  if (!f) return;
  try {
    const incoming = await S.readBackup(await f.text(), $('s-rpass').value);
    const { entries: merged, added, dup } = mergeEntries(await S.loadEntries(), incoming);
    entries = merged;
    await S.saveEntries(entries);
    render();
    $('s-rpass').value = '';
    smsg(`${plural(added, 'fiche restaurée', 'fiches restaurées')}` + (dup ? `, ${plural(dup, 'déjà présente', 'déjà présentes')}` : '') + '.');
  } catch (e) { smsg(e.message, true); }
});

// Export en clair : deux clics, le second confirme (pas de boîte de dialogue du navigateur).
let csvTimer = 0, csvArmed = false;
function resetCsvButton() {
  clearTimeout(csvTimer);
  csvArmed = false;
  $('s-csv').textContent = 'Exporter en CSV (mots de passe en clair)';
}
$('s-csv').addEventListener('click', () => {
  if (!csvArmed) {
    csvArmed = true;
    $('s-csv').textContent = 'Confirmer : le fichier contiendra tous les mots de passe en clair';
    csvTimer = setTimeout(resetCsvButton, 6000);
    return;
  }
  resetCsvButton();
  download('coffre-export.csv', toCSV(entries), 'text/csv');
  smsg('CSV exporté. Supprime-le dès que tu n\'en as plus besoin.');
});

$('s-never-reset').addEventListener('click', async () => {
  await S.setSettings({ neverSave: [] });
  $('s-never').textContent = 'Aucun site n\'est ignoré.'; $('s-never-reset').hidden = true;
  smsg('Enregistrement réactivé pour tous les sites.');
});

// Le coffre peut changer ailleurs (fenêtre « Ajouter » d'un autre onglet) : on recharge la liste, sinon
// une modification faite ici écraserait l'ajout avec une version périmée.
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local' || !c.vault || $('app').hidden) return;
  S.loadEntries().then((e) => { entries = e; render(); }).catch(() => {});
});

// Si le coffre est verrouillé ailleurs, on le reflète ici.
chrome.storage.session.onChanged.addListener((c) => { if (c.key) route(); });
route();
