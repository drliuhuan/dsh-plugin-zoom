# dsh-plugin-zoom

[![npm version](https://img.shields.io/npm/v/dsh-plugin-zoom.svg)](https://www.npmjs.com/package/dsh-plugin-zoom)
[![license](https://img.shields.io/npm/l/dsh-plugin-zoom.svg)](https://github.com/drliuhuan/dsh-plugin-zoom/blob/main/LICENSE)

A DeepSeek Harness plugin that adds a **manual interface-zoom** preference, so
the Web UI can be enlarged or shrunk on high-DPI displays and make its text
easier to read.

English | [中文说明](https://github.com/drliuhuan/dsh-plugin-zoom/blob/main/README.zh.md)

## Features

Three entry points drive one zoom value (75 %–200 %, 5 % steps):

- **Settings → General → Interface zoom**: a stepper with zoom-in/zoom-out
  arrows, the current zoom (e.g. `125 %`), the display scale the window is
  rendered at (e.g. `当前显示器：200%`), and a **Reset** action back to 100 %.
- **Ctrl (⌘ on macOS) + mouse wheel** anywhere in the window: zooms in 5 % steps
  and cancels the page's own wheel zoom so only one zoom applies.
- A compact **`− 125 % +`** control in the **Session header's top-right corner**
  (in the header utilities, after the shipped buttons). Click the percentage to
  reset to 100 %.

The preference is remembered (host-scoped cookie plus a same-origin
`localStorage` mirror), so it survives reloads and app restarts.

## How it works

The Client half sets one CSS property on the document root:

```css
html { zoom: 1.25; }
```

Chromium scales layout, text, and fixed/overlay surfaces together, so the whole
Web UI — dialogs, menus, toasts, and the settings panel itself — follows one
ratio, and text is re-rasterized at the larger size rather than stretched. The
settings row is registered in the host's own `settings.general.item` seat, the
header control in the Session header's additive
`conversation.session.header.utilities` seat, and both are styled with host theme
tokens, matching the surrounding controls in light and dark themes.

## Why a plugin and not the OS setting

Windows display scaling changes *physical* size but not the app's *logical*
density. On a large high-DPI monitor the UI can still be too small (or, for some
users, too large) for comfortable reading. The operating-system setting also
affects every application. This plugin zooms only the Harness Web UI, by a value
you pick, and remembers it.

## Fixed in 0.1.2: tooltips and menus drifting once zoomed

A CSS `zoom` on the document root makes Chromium report
`getBoundingClientRect()` and `window.innerWidth`/`innerHeight` in *visual*
(already zoomed) pixels, while `position: fixed` descendants are zoomed a
second time. The host UI positions its tooltips, hover cards and menus from
exactly those values, so they drifted away from their anchor by
(scale − 1) × distance from the top-left corner — the bug reported against
0.1.1. 0.1.2 installs a geometry-space shim that converts those reads back to
the layout pixels CSS uses (and, after a one-time auto-detection, pointer
`clientX`/`clientY` too), so the host's own positioning, drag and hit-test math
behaves exactly as it does at 100 %. The shim is the identity at 100 % and
unload restores the prototypes. React DevTools fixed the same browser behavior
in [facebook/react#37519](https://github.com/facebook/react/pull/37519).

Escape hatch if you need to compare against the uncompensated behavior (browser
DevTools console; takes effect after a reload):

```js
localStorage.setItem('dsh-plugin-zoom:no-geometry-shim', '1');
// localStorage.removeItem('dsh-plugin-zoom:no-geometry-shim');
```

## Notes and limits

- The zoom is remembered in the browser through a cookie (host-scoped, so it
  survives the desktop shell's per-launch loopback port change) with
  `localStorage` as a same-origin mirror.
- The zoom is a presentation preference; the Host writes nothing, and the agent
  receives no state from it.
- Fractional zoom is allowed, but for the crispest text prefer whole
  percentages: 100 %, 125 %, 150 %, 200 %.
- Electron's **native window buttons are not scaled** by an in-page CSS zoom
  (they are drawn by the OS above the page). At scales far from 100 % the
  custom titlebar can look slightly taller than the native caption buttons. This
  is a cosmetic limitation of every renderer-side zoom; the plugin deliberately
  does not touch Electron's native window zoom, which a plugin's Host half
  (a separate Node-mode process) cannot reach.
- A high zoom makes the shell's logical window narrower; the sidebar may
  auto-collapse earlier, exactly as it would with browser page zoom.
- Scrolling containers, dialogs, menus, and toasts are all inside the zoomed
  document, so they follow the same ratio.
- The plugin was previously named `dsh-plugin-dpi-scale`; a zoom already chosen
  under that name is migrated automatically the first time this version loads.

## Requirements

- A DSH profile that supports bundles (`@deepseek-ai/dsh-base` / Web profile).
  Developed and verified against DSH desktop 0.2.1-rc.2.
- Node.js >= 22 is only needed for the repository check script.

## Installation

Install from npm through the DSH plugin manager:

```
plugin_manager action=install_bundle target=dsh-plugin-zoom@0.1.2
```

Or install from a local checkout (a directory install links the checkout, which
is convenient while developing):

```
plugin_manager action=install_bundle target=D:\path\to\dsh-plugin-zoom
```

A new bundle is applied through HMR immediately; after changing the plugin's
source, reload the page (or restart DSH) to load a fresh client module.

## Develop

- `client.js` — the whole feature: preference state, document zoom, the
  Ctrl+wheel shortcut, the General row, and the Session-header control (plain
  classic script registered on `window.__ModuleLoader__`).
- `index.js` — the Host half; intentionally empty.
- `cordis.patch.yml` — inserts the `zoom` Loader row.
- `locale/*.json` — Plugin Manager title/description (en, zh).

Run `npm run check` before committing.

## Publishing

`.github/workflows/publish.yml` publishes through **npm trusted publishing
(OIDC)**. Configure this repository (workflow `publish.yml`, environment
`npm`) as a trusted publisher on npmjs.com, then publish a GitHub release whose
tag equals the `package.json` version (for example `v0.1.1`). The workflow
checks that the tag matches, validates the packed files, and publishes with
provenance.

## License

MIT. See [LICENSE](https://github.com/drliuhuan/dsh-plugin-zoom/blob/main/LICENSE).
