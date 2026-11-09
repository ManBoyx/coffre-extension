// Script de page : icône dans les champs de connexion, menu des identifiants du site,
// et proposition « Ajouter » en haut à droite quand un nouveau mot de passe est détecté.
// Rien n'est rempli sans un vrai clic de l'utilisateur (les clics simulés par la page sont ignorés).
(() => {
  if (window.top !== window) return;

  const send = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); }
  });
  const trusted = (fn) => (e) => { if (e.isTrusted) fn(e); };

  // ------------------------------------------------------------ détection des champs
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const pwFields = () => [...document.querySelectorAll('input[type=password]')].filter(visible);
  const TEXTY = ['text', 'email', 'tel', 'url', ''];
  const typeOf = (i) => (i.getAttribute('type') || '').toLowerCase();

  function userFieldFor(pw) {
    const scope = pw.form || document;
    const cands = [...scope.querySelectorAll('input')].filter((i) => TEXTY.includes(typeOf(i)) && visible(i) && !i.disabled);
    const before = cands.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before[before.length - 1] || null;
  }

  const LOGINISH = /user|login|e-?mail|ident|account|compte|pseudo/i;
  function looksLikeUsername(i) {
    if (!TEXTY.includes(typeOf(i)) || i.disabled || i.readOnly || !visible(i)) return false;
    const ac = (i.getAttribute('autocomplete') || '').toLowerCase();
    if (ac.includes('username') || ac.includes('email')) return true;
    return LOGINISH.test(`${i.name} ${i.id} ${i.placeholder}`) && !/search|recherch/i.test(`${i.name} ${i.id} ${i.placeholder}`);
  }

  function loginFields() {
    const out = new Map();
    const pws = pwFields();
    for (const pw of pws) {
      out.set(pw, 'pw');
      const u = userFieldFor(pw);
      if (u) out.set(u, 'user');
    }
    // Connexion en deux étapes : seul l'identifiant est affiché. On ne l'affiche que s'il existe un identifiant pour ce site.
    if (!pws.length && state.entries.length) {
      for (const i of document.querySelectorAll('input')) if (looksLikeUsername(i)) out.set(i, 'user');
    }
    return out;
  }

  function setValue(el, v) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fill(cred, target) {
    const pw = pwFields()[0];
    let u = pw ? userFieldFor(pw) : null;
    if (!pw && target && target.type !== 'password') u = target;
    if (u && cred.username) setValue(u, cred.username);
    if (pw) setValue(pw, cred.password);
    (pw || u)?.focus();
  }

  // ------------------------------------------------------------ interface (shadow DOM fermé)
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font:14px/1.4 system-ui,-apple-system,sans-serif}
    #layer{position:fixed;inset:0;pointer-events:none}
    .ic{all:unset;position:fixed;left:0;top:0;width:22px;height:22px;border-radius:3px;background:#1f5f52;border:1px solid #fbf8f0;
        display:grid;place-items:center;cursor:pointer;pointer-events:auto}
    .ic.off{background:#5a5244}.ic:hover{background:#17493f}.ic:focus-visible{outline:2px solid #1f5f52;outline-offset:2px}
    .ic svg{width:14px;height:14px;fill:#fbf8f0}
    .ic b{position:absolute;top:-6px;right:-6px;min-width:15px;height:15px;border-radius:3px;background:#8a2b20;color:#fbf8f0;
          font:700 10px/15px ui-monospace,Menlo,monospace;text-align:center;padding:0 3px}
    .card{position:fixed;pointer-events:auto;background:#fbf8f0;color:#1d1a14;border:1px solid #1d1a14;border-radius:0;
          box-shadow:3px 3px 0 rgb(29 26 20 / .28);padding:12px}
    #menu{min-width:260px;max-width:min(380px,92vw);padding:6px}
    #menu .hd{padding:6px 8px;font:italic 500 13px/1.2 "Iowan Old Style","Source Serif 4","Noto Serif",Georgia,serif;color:#5a5244}
    .it{all:unset;box-sizing:border-box;display:block;width:100%;padding:8px 10px;border-bottom:1px solid #d6ccb6;cursor:pointer;font:14px/1.35 system-ui,sans-serif}
    .it:hover{background:#e9e1cf}.it:focus-visible{background:#e9e1cf;outline:2px solid #1f5f52;outline-offset:-2px}
    .it small{display:block;color:#5a5244;font:12px/1.3 ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
    .it.sub{color:#5a5244;font-size:13px;border-bottom:0}
    #toast{top:16px;right:16px;width:min(340px,92vw)}
    #toast .t{font:500 16px/1.25 "Iowan Old Style","Source Serif 4","Noto Serif",Georgia,serif;margin-bottom:4px}
    #toast .m{color:#5a5244;font-size:13px;margin-bottom:12px;overflow-wrap:anywhere}
    .row{display:flex;gap:8px}
    .row .it{text-align:center;border:1px solid #8a7f6b;border-radius:3px;padding:7px 10px}
    .row .it.pri{background:#1f5f52;border-color:#1f5f52;color:#fbf8f0;font-weight:600}
    .row .it.pri:hover{background:#17493f}
    @media (prefers-reduced-motion:reduce){*{transition:none!important}}
  </style><div id="layer"></div><div id="menu" class="card" hidden></div><div id="toast" class="card" hidden></div>`;
  const layer = root.getElementById('layer');
  const menu = root.getElementById('menu');
  const toast = root.getElementById('toast');

  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const KEY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14a5 5 0 1 1 4.9-6H22v4h-2v3h-3v-3h-5.1A5 5 0 0 1 7 14zm0-7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';

  function mount() { if (!host.isConnected) document.documentElement.appendChild(host); }

  // ------------------------------------------------------------ état des identifiants du site
  let state = { locked: false, entries: [] };
  let lastRefresh = 0;
  async function refresh(force) {
    if (!force && Date.now() - lastRefresh < 2000) return;
    lastRefresh = Date.now();
    const r = await send({ type: 'match' });
    state = r.locked ? { locked: true, entries: [] } : { locked: false, entries: r.entries || [] };
    updateBadges();
  }

  // ------------------------------------------------------------ icônes dans les champs
  const icons = new Map(); // champ -> bouton
  function makeIcon(field) {
    const b = el('button', '', 'ic');
    b.type = 'button';
    b.innerHTML = KEY_SVG;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', trusted(() => openMenu(field)));
    layer.appendChild(b);
    return b;
  }
  function updateBadges() {
    for (const b of icons.values()) {
      b.classList.toggle('off', state.locked);
      b.title = state.locked ? 'Coffre verrouillé' : state.entries.length ? 'Choisir un identifiant' : 'Aucun identifiant pour ce site';
      b.querySelector('b')?.remove();
      if (state.entries.length) b.appendChild(el('b', String(state.entries.length)));
    }
  }
  function place(b, f) {
    const r = f.getBoundingClientRect();
    const size = 22;
    let x = r.right - size - 8;
    const y = r.top + (r.height - size) / 2;
    for (let k = 0; k < 2; k++) { // évite de recouvrir un bouton de la page (œil, etc.)
      const hit = document.elementFromPoint(x + size / 2, y + size / 2);
      if (hit && hit !== f && !f.contains(hit) && hit !== host) x -= size + 6; else break;
    }
    b.style.transform = `translate(${x}px,${y}px)`;
    b.hidden = r.width < 90 || r.bottom < 0 || r.top > innerHeight;
  }
  function layout() {
    const fields = loginFields();
    for (const [f, b] of icons) if (!fields.has(f) || !f.isConnected) { b.remove(); icons.delete(f); }
    for (const f of fields.keys()) {
      if (!icons.has(f)) { icons.set(f, makeIcon(f)); mount(); updateBadges(); }
      place(icons.get(f), f);
    }
  }
  let raf = 0, deb = 0;
  // rAF est suspendu dans les onglets en arrière-plan : un minuteur de secours garantit que les icônes sont posées.
  const frame = () => {
    if (raf) return;
    raf = 1;
    const run = () => { if (!raf) return; raf = 0; layout(); };
    requestAnimationFrame(run);
    setTimeout(run, 120);
  };
  const soon = () => { clearTimeout(deb); deb = setTimeout(frame, 250); };
  addEventListener('scroll', () => { closeMenu(); frame(); }, { capture: true, passive: true });
  addEventListener('resize', () => { closeMenu(); frame(); }, { passive: true });
  addEventListener('focusin', () => { refresh(false); frame(); }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(true); frame(); } });
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });

  // ------------------------------------------------------------ menu des identifiants
  let menuField = null;
  function closeMenu() { menu.hidden = true; menuField = null; }
  async function openMenu(field) {
    if (!field) return;
    mount();
    menuField = field;
    await refresh(true);
    menu.replaceChildren(el('div', state.locked ? 'Coffre verrouillé' : 'Identifiants pour ce site', 'hd'));
    if (state.locked) {
      const b = el('button', 'Déverrouiller le coffre', 'it');
      b.addEventListener('click', trusted(() => { send({ type: 'openvault' }); closeMenu(); }));
      menu.appendChild(b);
    } else if (!state.entries.length) {
      menu.appendChild(el('div', 'Aucun identifiant enregistré pour ce site. Connecte-toi : le coffre proposera de l\'ajouter.', 'hd'));
    } else {
      for (const e of state.entries) {
        const b = el('button', '', 'it');
        b.append(e.username || '(sans identifiant)', el('small', e.host));
        b.addEventListener('click', trusted(async () => {
          const c = await send({ type: 'cred', id: e.id });
          const f = menuField;
          closeMenu();
          if (!c.error && !c.locked) fill(c, f);
        }));
        menu.appendChild(b);
      }
    }
    const open = el('button', 'Ouvrir le coffre', 'it sub');
    open.addEventListener('click', trusted(() => { send({ type: 'openvault' }); closeMenu(); }));
    menu.appendChild(open);
    menu.hidden = false;
    const r = field.getBoundingClientRect();
    const w = Math.min(Math.max(r.width, 280), innerWidth - 16);
    menu.style.width = w + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    const h = menu.offsetHeight;
    menu.style.top = (r.bottom + 6 + h > innerHeight && r.top - h - 6 > 0 ? r.top - h - 6 : r.bottom + 6) + 'px';
    menu.querySelector('.it')?.focus();
  }
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.composedPath().includes(host)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); hideToast(); } }, true);

  // ------------------------------------------------------------ fenêtre « Ajouter » (en haut à droite)
  let toastTimer = 0;
  function hideToast() { toast.hidden = true; clearTimeout(toastTimer); }
  function showToast(title, text, buttons, ttl = 30000) {
    mount();
    toast.replaceChildren(el('div', title, 't'), el('div', text, 'm'));
    const row = el('div', '', 'row');
    for (const [label, cls, fn] of buttons) {
      const b = el('button', label, 'it ' + cls);
      b.addEventListener('click', trusted(fn));
      row.appendChild(b);
    }
    toast.appendChild(row);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ttl);
  }

  async function checkPending() {
    const p = await send({ type: 'pending' });
    if (!p.status) return;
    const who = `${p.username || '(sans identifiant)'} sur ${p.host}  ·  ••••••••`;
    const isNew = p.status === 'new';
    showToast(isNew ? 'Enregistrer ce mot de passe ?' : 'Mettre à jour le mot de passe ?', who, [
      [isNew ? 'Ajouter' : 'Mettre à jour', 'pri', async () => {
        await send({ type: 'commit' });
        showToast('Enregistré dans le coffre', who, [], 2500);
      }],
      ['Plus tard', '', async () => { await send({ type: 'dismiss' }); hideToast(); }],
      ...(isNew ? [['Jamais', '', async () => { await send({ type: 'never' }); hideToast(); }]] : []),
    ]);
  }

  // ------------------------------------------------------------ capture à la connexion
  let lastCapture = 0;
  async function capture() {
    const pw = pwFields().find((f) => f.value);
    if (!pw || Date.now() - lastCapture < 500) return;
    lastCapture = Date.now();
    const u = userFieldFor(pw);
    const r = await send({ type: 'capture', username: u ? u.value : '', password: pw.value });
    if (r.locked) {
      showToast('Coffre verrouillé', 'Ce mot de passe n\'a pas été enregistré. Déverrouille le coffre, puis reconnecte-toi.', [
        ['Déverrouiller', 'pri', () => { send({ type: 'openvault' }); hideToast(); }],
        ['Fermer', '', hideToast],
      ]);
      return;
    }
    setTimeout(checkPending, 1500);
  }
  document.addEventListener('submit', capture, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'password') capture();
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button,input[type=submit],[role=button]') : null;
    if (b && pwFields().some((f) => f.value)) capture();
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'picker') return;
    const f = document.activeElement && icons.has(document.activeElement) ? document.activeElement : [...icons.keys()][0];
    if (f) openMenu(f);
  });

  refresh(true).then(frame);
  checkPending();
})();
