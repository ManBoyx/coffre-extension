import * as S from './lib/store.js';
import { matchEntries, hostOf, baseDomain, sameSite, newEntry } from './lib/vault.js';

const PENDING_TTL_MS = 2 * 60 * 1000;

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'autolock') S.lock();
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('vault.html') });
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'fill') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'picker' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  // Seuls les scripts de page de cette extension (onglet web) sont servis ici.
  if (sender.id !== chrome.runtime.id || !sender.tab?.url) return false;
  handle(msg, sender.tab).then(send, (e) => send({ error: String(e.message || e) }));
  return true;
});

const pendingKey = (tabId) => `pending:${tabId}`;

async function handle(msg, tab) {
  if (msg.type === 'openvault') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('vault.html') });
    return {};
  }
  const state = await S.getState();
  if (!state.unlocked) return { locked: true };
  const pageUrl = tab.url; // jamais l'URL fournie par la page

  switch (msg.type) {
    case 'match': {
      const list = matchEntries(await S.loadEntries(), pageUrl);
      return { entries: list.map((e) => ({ id: e.id, username: e.username, host: hostOf(e.url) })) };
    }
    case 'cred': {
      const e = (await S.loadEntries()).find((x) => x.id === msg.id);
      if (!e || !sameSite(e.url, pageUrl)) throw new Error('Identifiant non autorisé pour ce site.');
      return { username: e.username, password: e.password };
    }
    case 'capture': {
      if (!msg.password || typeof msg.password !== 'string') return {};
      if ((await S.getSettings()).neverSave.includes(baseDomain(hostOf(pageUrl)))) return { skipped: true };
      await chrome.storage.session.set({
        [pendingKey(tab.id)]: { url: pageUrl, username: String(msg.username || ''), password: msg.password, ts: Date.now() },
      });
      return {};
    }
    case 'pending': {
      const k = pendingKey(tab.id);
      const p = (await chrome.storage.session.get(k))[k];
      if (!p) return {};
      if (Date.now() - p.ts > PENDING_TTL_MS || !sameSite(p.url, pageUrl)) {
        await chrome.storage.session.remove(k);
        return {};
      }
      const found = (await S.loadEntries()).find((e) => sameSite(e.url, p.url) && e.username === p.username);
      if (found && found.password === p.password) {
        await chrome.storage.session.remove(k);
        return {};
      }
      return { status: found ? 'update' : 'new', username: p.username, host: hostOf(p.url) };
    }
    case 'commit': {
      const k = pendingKey(tab.id);
      const p = (await chrome.storage.session.get(k))[k];
      if (!p) return {};
      const entries = await S.loadEntries();
      const found = entries.find((e) => sameSite(e.url, p.url) && e.username === p.username);
      if (found) {
        found.password = p.password;
        found.modified = Date.now();
      } else {
        const u = new URL(p.url);
        entries.push(newEntry({ name: hostOf(p.url), url: u.origin, username: p.username, password: p.password }));
      }
      await S.saveEntries(entries);
      await chrome.storage.session.remove(k);
      return { saved: true };
    }
    case 'dismiss':
      await chrome.storage.session.remove(pendingKey(tab.id));
      return {};
    case 'never': {
      const s = await S.getSettings();
      const d = baseDomain(hostOf(pageUrl));
      if (d && !s.neverSave.includes(d)) await S.setSettings({ neverSave: [...s.neverSave, d] });
      await chrome.storage.session.remove(pendingKey(tab.id));
      return {};
    }
    default:
      throw new Error('Message inconnu.');
  }
}
