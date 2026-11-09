[Français](README.md) · **English**

# Coffre

A local password manager for Helium / Chromium. Everything stays on your computer, encrypted.

## Installation
1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked**, then choose this folder.
3. Click the Coffre icon: create your master password (12 characters minimum).
   It cannot be recovered if you lose it.
4. **Import a CSV** to bring your passwords over (Chrome format: `name,url,username,password,note`).
   Then delete the file: it contains your passwords in clear text.

After updating the code, click Coffre's reload button in `chrome://extensions` and reload pages that are already open.

## Usage
- **Fill**: on a login page, a small key appears in the fields. A badge shows the number of credentials for the site.
  Click the key, then the credential you want. Nothing is filled without a click. The `Ctrl+Shift+L` shortcut also opens
  the menu, but the browser may already use it (change it in `chrome://extensions/shortcuts`).
- **Save**: after logging in with a new password, a panel at the top right offers **Add** (or **Update** if the password
  changed). **Never** turns the prompt off for that site.
- **Manage**: the toolbar icon opens the vault. On the left, an index of entries by letter with search (`/` to jump to it,
  `↓` `↑` to browse); on the right, the open entry: copy, show, edit, delete. Visual direction and the reasons behind the
  choices: `DESIGN.md` (in French).
- **Locking**: by default, once the master password is entered, the vault **stays unlocked until you click Lock**, even
  after the browser restarts. A checkbox on opening and in the settings turns this mode off; the vault then locks when the
  browser closes or after a delay (5 min, 15 min, 1 h).
- **Settings**: locking mode, master password change, encrypted backup / restore, CSV export, list of ignored sites.

## Security
- Key derived from the master password with PBKDF2-SHA256 (600,000 iterations), AES-256-GCM encryption.
- The encrypted vault lives in the extension's local storage. In "stay unlocked" mode (the default), the encryption key is
  also kept **on disk** (`storage.local`, key `keptKey`): anyone with access to your browser profile can then read the vault
  without the password. The Lock button erases it. Without this mode, the key is only **in memory** (`storage.session`):
  erased when the browser closes and after the lock delay.
- A credential is handed to a page only if the site matches (base domain, without confusing shared hosts such as
  `github.io` or `pages.dev`) **and** after a real user click. The page script does not accept clicks simulated by the site.
- The interface injected into pages is isolated in a closed shadow DOM.
- A backup contains only the already-encrypted vault. Reading it requires the master password that was in force at that time.

## Known limitations
- Personal project, **not audited**. For your most sensitive accounts, a proven password manager is preferable.
- No synchronization between devices.
- Forms inside an iframe or inside closed web components are not supported.
- Session cookies are not handled.

## Tests
Node 20 or newer, no dependencies.

    node test/vault.test.mjs [file.csv]   # encryption, CSV, site matching
    node test/flow.test.mjs               # storage + background service (simulated chrome API)
    node test/browser.test.mjs            # real headless Helium, real clicks (HELIUM=/path if needed)

## License
[GPL-3.0](LICENSE).
