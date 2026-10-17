// dsh-plugin-zoom — client half.
//
// Manual interface scaling for high-DPI displays. The feature is one CSS
// property on the document root: `zoom: <scale>`. Chromium scales layout,
// text, and fixed/overlay surfaces together, so the whole Web UI (including
// dialogs and the settings panel itself) follows one ratio, and text is
// re-rasterized at the larger size instead of being stretched.
//
// The row lives in Settings → General (`settings.general.item`, the additive
// seat for a single preference). The preference is a browser-side value: a
// host-scoped cookie (so it survives the desktop shell's per-launch port) with
// a same-origin localStorage mirror. Nothing is written on the Host.
(function () {
  'use strict';

  /** The Loader row name, which is also this browser artifact's module id. */
  var PLUGIN_ID = 'dsh-plugin-zoom';

  /** Versioned preference key; a future shape change cannot misread old data. */
  var STORAGE_KEY = 'dsh-plugin-zoom:v1';

  /**
   * Cookie mirror of the same preference. The desktop shell serves the GUI on a
   * random loopback port each launch, and `localStorage` is origin-scoped — the
   * port is part of the origin, but a cookie's scope is the host only. The
   * cookie is therefore what keeps the chosen scale across app restarts.
   */
  var COOKIE_NAME = 'dsh_zoom';
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

  /**
   * Pre-rename identifiers. The plugin shipped briefly as `dsh-plugin-dpi-scale`;
   * a scale already picked under that name is migrated once on load.
   */
  var LEGACY_STORAGE_KEY = 'dsh-plugin-dpi-scale:v1';
  var LEGACY_COOKIE_NAME = 'dsh_dpi_scale';

  /** Locale namespace owned by this plugin (registered in apply). */
  var LOCALE_NS = 'zoom';

  /** Accepted scale range, as whole percent. */
  var MIN_SCALE = 75;
  var MAX_SCALE = 200;
  var STEP = 5;
  var DEFAULT_SCALE = 100;

  /** Ctrl(⌘)+wheel: accumulated wheel delta for one 5% step, and the idle reset. */
  var WHEEL_STEP_DELTA = 20;
  var WHEEL_RESET_MS = 400;

  /** `{dpi}` receives the detected display scale, e.g. "200%". */
  var EN = {
    title: 'Interface zoom',
    description: 'Zoom the whole interface to keep text clear on high-DPI displays (current display: {dpi}).',
    decrease: 'Zoom out',
    increase: 'Zoom in',
    reset: 'Reset',
    resetTitle: 'Reset to 100%',
    valueUnit: '%'
  };

  var ZH = {
    title: '界面缩放',
    description: '按比例缩放整个界面，让高 DPI 屏幕上的文字更清晰（当前显示器：{dpi}）。',
    decrease: '缩小界面',
    increase: '放大界面',
    reset: '重置',
    resetTitle: '重置为 100%',
    valueUnit: '%'
  };

  /**
   * Row styling copied from the host's own General preference rows
   * (`ui-theme`'s font-size row and `ui-settings-general`'s row module): same
   * paddings, type sizes, border and hover behavior, with only `--dsw-*` theme
   * tokens so light/dark themes both apply. Class names are plugin-prefixed.
   */
  var ROW_CSS = [
    '.zoom_row{display:flex;align-items:center;gap:8px;padding:16px 0;',
    'border-bottom:.5px solid var(--dsw-alias-border-l2)}',
    '.zoom_text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}',
    '.zoom_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
    '.zoom_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
    '.zoom_control{display:inline-flex;align-items:center;gap:8px}',
    '.zoom_stepper{display:inline-flex;align-items:center;justify-content:center;min-width:96px;',
    'height:36px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);position:relative}',
    '.zoom_value{min-width:48px;text-align:center;font-variant-numeric:tabular-nums;',
    'color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
    '.zoom_arrows{position:absolute;right:8px;display:flex;flex-direction:column;gap:2px;opacity:0}',
    '.zoom_stepper:hover .zoom_arrows,.zoom_stepper:focus-within .zoom_arrows{opacity:1}',
    '@media (hover:none){.zoom_arrows{opacity:1}}',
    '.zoom_arrow{display:inline-flex;align-items:center;justify-content:center;width:17px;height:12px;',
    'padding:0;border:none;border-radius:var(--dsw-radius-xs);',
    'background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 75%, transparent);',
    'color:var(--dsw-alias-label-primary);cursor:pointer}',
    '.zoom_arrow:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}',
    '.zoom_arrow:disabled{color:var(--dsw-alias-label-caption);cursor:default}',
    '.zoom_reset{font:inherit;font-size:12px;line-height:18px;padding:6px 8px;',
    'border:none;border-radius:var(--dsw-radius-sm);background:0 0;',
    'color:var(--dsw-alias-label-secondary);cursor:pointer}',
    '.zoom_reset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);',
    'color:var(--dsw-alias-label-primary)}',
    '.zoom_reset:disabled{color:var(--dsw-alias-label-caption);cursor:default}',
    '.zoom_arrow:focus-visible,.zoom_reset:focus-visible{',
    'outline:2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}'
  ].join('');

  /**
   * Header control styling: a compact pill of `− 125% +` that lives in the
   * Session header's right-aligned utilities row. Same rule as the settings row:
   * host theme tokens only, so light and dark both apply.
   */
  var HUD_CSS = [
    '.zoomHud{display:inline-flex;align-items:center;gap:2px;height:28px}',
    '.zoomHud_button{display:inline-flex;align-items:center;justify-content:center;',
    'width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm);',
    'background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;',
    'font-size:15px;line-height:1;cursor:pointer}',
    '.zoomHud_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);',
    'color:var(--dsw-alias-label-primary)}',
    '.zoomHud_button:disabled{color:var(--dsw-alias-label-caption);cursor:default}',
    '.zoomHud_value{display:inline-flex;align-items:center;justify-content:center;',
    'min-width:40px;height:24px;padding:0 4px;border:none;border-radius:var(--dsw-radius-sm);',
    'background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;',
    'font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;cursor:pointer}',
    '.zoomHud_value:hover{background:var(--dsw-alias-interactive-bg-hover);',
    'color:var(--dsw-alias-label-primary)}',
    '.zoomHud_button:focus-visible,.zoomHud_value:focus-visible{',
    'outline:2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}'
  ].join('');

  /** The active locale service, captured on apply for change subscription. */
  var localeFace = null;

  /** React runtime, assigned when the loader materializes this module. */
  var React = null;

  //#region preference state -------------------------------------------------

  /** Clamp to the supported range and snap to the 5% grid. */
  function normalizeScale(value) {
    var number = Number(value);
    if (!isFinite(number)) return DEFAULT_SCALE;
    var clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, number));
    return Math.round(clamped / STEP) * STEP;
  }

  /** Reader for one localStorage key; null when absent or unreadable. */
  function readStoredScale(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      var parsed = JSON.parse(raw);
      return normalizeScale(parsed !== null && typeof parsed === 'object' ? parsed.scale : parsed);
    } catch (error) {
      return null;
    }
  }

  /** Reader for one cookie; null when absent or unreadable. */
  function readCookieScale(name) {
    try {
      var match = new RegExp('(?:^|;\\s*)' + name + '=(\\d{1,3})(?:;|$)').exec(document.cookie);
      if (match === null) return null;
      return normalizeScale(match[1]);
    } catch (error) {
      return null;
    }
  }

  function writeCookieScale(scale) {
    try {
      var secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = COOKIE_NAME + '=' + scale + '; Path=/; Max-Age=' + COOKIE_MAX_AGE + '; SameSite=Lax' + secure;
    } catch (error) {
      // Cookies can be disabled; localStorage below still carries the value.
    }
  }

  function writeStoredScale(scale) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: scale }));
    } catch (error) {
      // A disabled/unavailable storage must not break the row; the scale still
      // applies for this page life and the cookie mirror may have succeeded.
    }
    writeCookieScale(scale);
  }

  /**
   * The remembered zoom. The cookie is read first because it survives the
   * desktop shell's per-launch port change; localStorage is the fallback for
   * builds where cookies are unavailable. Whatever is found is written back to
   * both stores, which also migrates the pre-rename keys exactly once.
   */
  function readPreference() {
    var scale = readCookieScale(COOKIE_NAME);
    if (scale === null) scale = readCookieScale(LEGACY_COOKIE_NAME);
    if (scale === null) scale = readStoredScale(STORAGE_KEY);
    if (scale === null) scale = readStoredScale(LEGACY_STORAGE_KEY);
    if (scale === null) scale = DEFAULT_SCALE;
    writeStoredScale(scale);
    return scale;
  }

  var currentScale = readPreference();
  var scaleListeners = [];

  function subscribeScale(listener) {
    scaleListeners.push(listener);
    return function () {
      var index = scaleListeners.indexOf(listener);
      if (index !== -1) scaleListeners.splice(index, 1);
    };
  }

  function notifyScale() {
    var snapshot = scaleListeners.slice();
    for (var index = 0; index < snapshot.length; index += 1) {
      try {
        snapshot[index]();
      } catch (error) {
        console.error('[' + PLUGIN_ID + '] scale listener failed:', error);
      }
    }
  }

  function getScale() {
    return currentScale;
  }

  /** Adopt a value learned from another tab without writing it back. */
  function adoptExternalScale(value) {
    var normalized = normalizeScale(value);
    if (normalized === currentScale) return;
    currentScale = normalized;
    applyDocumentScale(normalized);
    nudgeOverlayLayout();
    notifyScale();
  }

  function setScale(value) {
    var normalized = normalizeScale(value);
    if (normalized === currentScale) return;
    currentScale = normalized;
    writeStoredScale(normalized);
    applyDocumentScale(normalized);
    nudgeOverlayLayout();
    notifyScale();
  }

  //#endregion

  //#region ctrl+wheel -------------------------------------------------------

  var wheelRemainder = 0;
  var wheelResetTimer = null;

  /** Clear the accumulated wheel delta after a gesture ends. */
  function resetWheelRemainder() {
    wheelRemainder = 0;
    wheelResetTimer = null;
  }

  /**
   * Ctrl (⌘ on macOS) + wheel adjusts the interface zoom directly and
   * `preventDefault()` keeps the browser/Electron page zoom from firing in
   * parallel. A conventional wheel notch is one 5% step; trackpad and pinch
   * events (many small deltas) accumulate so a gesture does not race through the
   * range.
   * @param {WheelEvent} event - the window wheel event.
   * @returns {void}
   */
  function handleZoomWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    if (wheelResetTimer !== null) clearTimeout(wheelResetTimer);
    wheelResetTimer = setTimeout(resetWheelRemainder, WHEEL_RESET_MS);
    wheelRemainder += Math.abs(event.deltaY);
    if (wheelRemainder < WHEEL_STEP_DELTA) return;
    wheelRemainder = 0;
    setScale(getScale() + (event.deltaY < 0 ? STEP : -STEP));
  }

  //#endregion

  //#region geometry space shim ----------------------------------------------

  /**
   * Under a CSS `zoom` on the document root, Chromium reports two different
   * coordinate spaces for the same DOM:
   *
   *  - CSS lengths (`left`, `width`, …) and layout metrics (`offsetWidth`,
   *    `scrollTop`, `body.clientWidth`, …) are in layout pixels; the renderer
   *    multiplies them by the zoom for display;
   *  - `getBoundingClientRect()`, `elementFromPoint()` and
   *    `window.innerWidth`/`innerHeight` are reported in visual pixels
   *    (layout × zoom).
   *
   * The host UI sizes and places its `position: fixed` tooltips, hover cards
   * and menus from a rect it just measured, so under a zoom the rect is already
   * visual while the fixed offset is zoomed a second time — the tooltip/menu
   * drifts by (scale − 1) × distance from the top-left corner. React DevTools
   * fixed the same browser behavior in facebook/react#37519.
   *
   * This shim makes the JS-visible geometry match the layout space that CSS
   * uses, so the host UI's own math runs exactly as it does at 100 %:
   *  - `getBoundingClientRect` divides by the zoom;
   *  - `window.innerWidth`/`innerHeight` divide by the zoom;
   *  - pointer `clientX`/`clientY` divide by the zoom, but only after the first
   *    real pointer event has confirmed (by comparing the event target's native
   *    and shimmed rects) that Chromium reports them in visual pixels — a
   *    detection that keeps the shim correct if that mapping ever changes.
   * Every getter is the identity at 100 %, and unload restores the prototypes.
   */
  var geometryShimRestore = null;
  var pointerCoordinatesAreVisual = null;

  /**
   * Escape hatch: set this key to "1" in the DevTools console and reload to run
   * the zoom without the geometry shim (for diagnosing an unrelated regression):
   *   localStorage.setItem('dsh-plugin-zoom:no-geometry-shim', '1')
   * and remove it with `removeItem` to turn the shim back on.
   */
  var SHIM_OPT_OUT_KEY = 'dsh-plugin-zoom:no-geometry-shim';

  function geometryShimDisabled() {
    try {
      return window.localStorage.getItem(SHIM_OPT_OUT_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  /** The zoom applied to the document, as a layout→visual multiplier. */
  function layoutFactor() {
    return currentScale === DEFAULT_SCALE ? 1 : currentScale / 100;
  }

  function rectContainsPoint(rect, x, y) {
    return x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2;
  }

  function installZoomGeometryShim() {
    if (geometryShimRestore !== null) return;
    if (geometryShimDisabled()) return;
    if (typeof Element === 'undefined' || typeof MouseEvent === 'undefined') return;
    var restores = [];
    var originalRect = Element.prototype.getBoundingClientRect;

    Element.prototype.getBoundingClientRect = function () {
      var rect = originalRect.call(this);
      var factor = layoutFactor();
      if (factor === 1) return rect;
      return new DOMRect(rect.x / factor, rect.y / factor, rect.width / factor, rect.height / factor);
    };
    restores.push(function () {
      Element.prototype.getBoundingClientRect = originalRect;
    });

    function patchWindowDimension(name) {
      var owner = window;
      var descriptor = null;
      while (owner !== null) {
        descriptor = Object.getOwnPropertyDescriptor(owner, name);
        if (descriptor !== undefined) break;
        owner = Object.getPrototypeOf(owner);
      }
      if (descriptor === undefined || typeof descriptor.get !== 'function') return;
      var nativeGetter = descriptor.get;
      var ownDescriptor = owner === window ? descriptor : null;
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          enumerable: descriptor.enumerable === true,
          get: function () {
            var value = nativeGetter.call(window);
            var factor = layoutFactor();
            return factor === 1 ? value : Math.round(value / factor);
          }
        });
      } catch (error) {
        return;
      }
      restores.push(function () {
        try {
          if (ownDescriptor !== null) Object.defineProperty(window, name, ownDescriptor);
          else delete window[name];
        } catch (error) {
          // A fresh page realm restores everything on reload anyway.
        }
      });
    }
    patchWindowDimension('innerWidth');
    patchWindowDimension('innerHeight');

    function patchPointerCoordinate(name) {
      var descriptor = Object.getOwnPropertyDescriptor(MouseEvent.prototype, name);
      if (descriptor === undefined || typeof descriptor.get !== 'function') return;
      var nativeGetter = descriptor.get;
      try {
        Object.defineProperty(MouseEvent.prototype, name, {
          configurable: true,
          enumerable: descriptor.enumerable === true,
          get: function () {
            var value = nativeGetter.call(this);
            var factor = layoutFactor();
            if (factor === 1 || pointerCoordinatesAreVisual !== true) return value;
            return value / factor;
          }
        });
      } catch (error) {
        return;
      }
      restores.push(function () {
        Object.defineProperty(MouseEvent.prototype, name, descriptor);
      });
    }
    patchPointerCoordinate('clientX');
    patchPointerCoordinate('clientY');

    // Learn once whether this Chromium reports pointer coordinates in visual
    // pixels. A mouse event only falls inside the target's native (visual) rect
    // or the shimmed (layout) rect, never both, for targets away from the
    // origin, so this converges after a few events.
    function detectPointerSpace(event) {
      if (pointerCoordinatesAreVisual !== null) return;
      var target = event.target;
      if (target === null || target === undefined || typeof target.getBoundingClientRect !== 'function') return;
      var visualRect = originalRect.call(target);
      var layoutRect = target.getBoundingClientRect();
      var inVisual = rectContainsPoint(visualRect, event.clientX, event.clientY);
      var inLayout = rectContainsPoint(layoutRect, event.clientX, event.clientY);
      if (inVisual && !inLayout) pointerCoordinatesAreVisual = true;
      else if (inLayout && !inVisual) pointerCoordinatesAreVisual = false;
    }
    window.addEventListener('pointermove', detectPointerSpace, true);
    window.addEventListener('pointerdown', detectPointerSpace, true);
    restores.push(function () {
      window.removeEventListener('pointermove', detectPointerSpace, true);
      window.removeEventListener('pointerdown', detectPointerSpace, true);
    });

    geometryShimRestore = function () {
      for (var index = restores.length - 1; index >= 0; index -= 1) {
        try {
          restores[index]();
        } catch (error) {
          // Best effort; a reload restores the realm.
        }
      }
      geometryShimRestore = null;
    };
  }

  function uninstallZoomGeometryShim() {
    if (geometryShimRestore !== null) geometryShimRestore();
  }

  //#endregion

  //#region document scale ---------------------------------------------------

  /**
   * The root element's pre-existing inline zoom, so unloading the plugin
   * restores exactly what was there before it touched the document.
   */
  var replacedZoom = null;

  function applyDocumentScale(scale) {
    if (typeof document === 'undefined' || document.documentElement === null) return;
    var root = document.documentElement;
    if (replacedZoom === null) replacedZoom = root.style.getPropertyValue('zoom');
    if (scale === DEFAULT_SCALE) {
      if (replacedZoom) root.style.setProperty('zoom', replacedZoom);
      else root.style.removeProperty('zoom');
      root.removeAttribute('data-dsh-zoom');
      return;
    }
    root.style.setProperty('zoom', String(scale / 100));
    root.setAttribute('data-dsh-zoom', String(scale));
  }

  /** Plugin unload leaves no trace on the document. */
  function restoreDocumentScale() {
    if (typeof document === 'undefined' || document.documentElement === null) return;
    var root = document.documentElement;
    if (replacedZoom) root.style.setProperty('zoom', replacedZoom);
    else root.style.removeProperty('zoom');
    root.removeAttribute('data-dsh-zoom');
  }

  /** Pending animation frame for the post-zoom resize nudge. */
  var resizeFrame = null;

  /**
   * Changing CSS zoom fires no window `resize`, but the shell positions
   * JS-placed overlays (menus, popovers, tooltips) from window metrics when it
   * opens them. One resize nudge after the scale settles lets an overlay that is
   * already open reposition into the zoomed coordinate space.
   * @returns {void}
   */
  function nudgeOverlayLayout() {
    if (typeof window === 'undefined') return;
    if (typeof window.requestAnimationFrame !== 'function') {
      window.dispatchEvent(new Event('resize'));
      return;
    }
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(function () {
      resizeFrame = null;
      window.dispatchEvent(new Event('resize'));
    });
  }

  /** The display scale the window is currently rendered at, e.g. "200%". */
  function detectDisplayScale() {
    var ratio = typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
    return Math.round(ratio * 100) + '%';
  }

  //#endregion

  //#region row ---------------------------------------------------------------

  /** Fallback translator used only if the injected locale seat is missing. */
  function fallbackTranslate(key, params) {
    var active = localeFace !== null && typeof localeFace.getLocale === 'function'
      ? String(localeFace.getLocale().active || '')
      : '';
    var dict = active.indexOf('zh') === 0 ? ZH : EN;
    var text = dict[key];
    if (text === undefined) return key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return name in params ? String(params[name]) : match;
    });
  }

  /** One chevron, sized for the stepper's arrow cells. */
  function chevron(direction) {
    var up = direction === 'up';
    return React.createElement(
      'svg',
      {
        viewBox: '0 0 12 8',
        width: 8,
        height: 6,
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block' }
      },
      React.createElement('path', {
        d: up ? 'M1 6.5 6 1.5 11 6.5' : 'M1 1.5 6 6.5 11 1.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      })
    );
  }

  /**
   * The live zoom value for a row/control: subscribes to scale changes (and to
   * locale changes, so translated copy re-renders) for the component lifetime.
   * @returns {number} the current zoom percentage.
   */
  function useZoomScale() {
    var state = React.useState(getScale());
    var setLocalScale = state[1];
    var localeTick = React.useState(0);
    var bumpLocale = localeTick[1];

    React.useEffect(function () {
      var unsubscribeScale = subscribeScale(function () {
        setLocalScale(getScale());
      });
      var unsubscribeLocale = null;
      if (localeFace !== null && typeof localeFace.subscribe === 'function') {
        unsubscribeLocale = localeFace.subscribe(function () {
          bumpLocale(function (tick) { return tick + 1; });
        });
      }
      return function () {
        unsubscribeScale();
        if (unsubscribeLocale !== null) unsubscribeLocale();
      };
    }, []);

    return state[0];
  }

  /**
   * The General Settings preference row: title, detected display scale, a
   * 5%-step stepper, and a reset action. Every visible string comes from the
   * plugin locale namespace (`t` prop), and every color from a theme token.
   * @param {object} props - composed slot props; `t` is bound by `locale`.
   * @returns {object} the row element tree.
   */
  function ZoomRow(props) {
    var translate = typeof props.t === 'function' ? props.t : fallbackTranslate;
    var scale = useZoomScale();
    var displayState = React.useState(detectDisplayScale());
    var displayScale = displayState[0];
    var setDisplayScale = displayState[1];

    React.useEffect(function () {
      function refreshDisplayScale() {
        setDisplayScale(detectDisplayScale());
      }
      window.addEventListener('resize', refreshDisplayScale);
      return function () {
        window.removeEventListener('resize', refreshDisplayScale);
      };
    }, []);

    return React.createElement(
      React.Fragment,
      null,
      React.createElement('style', {
        key: 'style',
        dangerouslySetInnerHTML: { __html: ROW_CSS }
      }),
      React.createElement(
        'div',
        { key: 'row', className: 'zoom_row' },
        React.createElement(
          'div',
          { className: 'zoom_text' },
          React.createElement('div', {
            className: 'zoom_title',
            children: translate('title')
          }),
          React.createElement('div', {
            className: 'zoom_desc',
            children: translate('description', { dpi: displayScale })
          })
        ),
        React.createElement(
          'div',
          { className: 'zoom_control' },
          React.createElement(
            'div',
            { className: 'zoom_stepper' },
            React.createElement('span', {
              className: 'zoom_value',
              children: String(scale) + translate('valueUnit')
            }),
            React.createElement(
              'span',
              { className: 'zoom_arrows' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'zoom_arrow',
                  'aria-label': translate('increase'),
                  title: translate('increase'),
                  disabled: scale >= MAX_SCALE,
                  onClick: function () { setScale(scale + STEP); }
                },
                chevron('up')
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'zoom_arrow',
                  'aria-label': translate('decrease'),
                  title: translate('decrease'),
                  disabled: scale <= MIN_SCALE,
                  onClick: function () { setScale(scale - STEP); }
                },
                chevron('down')
              )
            )
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'zoom_reset',
              title: translate('resetTitle'),
              disabled: scale === DEFAULT_SCALE,
              onClick: function () { setScale(DEFAULT_SCALE); }
            },
            translate('reset')
          )
        )
      )
    );
  }

  /**
   * The Session header's zoom control: `− 125% +` in the header's far-right
   * utilities. Clicking the percentage resets to 100 %. Registered into
   * `conversation.session.header.utilities`.
   * @param {object} props - composed slot props; `t` is bound by `locale`.
   * @returns {object} the control element tree.
   */
  function HeaderZoomControl(props) {
    var translate = typeof props.t === 'function' ? props.t : fallbackTranslate;
    var scale = useZoomScale();
    return React.createElement(
      React.Fragment,
      null,
      React.createElement('style', {
        key: 'style',
        dangerouslySetInnerHTML: { __html: HUD_CSS }
      }),
      React.createElement(
        'div',
        { key: 'hud', className: 'zoomHud' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'zoomHud_button',
            'aria-label': translate('decrease'),
            title: translate('decrease'),
            disabled: scale <= MIN_SCALE,
            onClick: function () { setScale(scale - STEP); }
          },
          '\u2212'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'zoomHud_value',
            'aria-label': translate('resetTitle'),
            title: translate('resetTitle'),
            onClick: function () { setScale(DEFAULT_SCALE); }
          },
          String(scale) + translate('valueUnit')
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'zoomHud_button',
            'aria-label': translate('increase'),
            title: translate('increase'),
            disabled: scale >= MAX_SCALE,
            onClick: function () { setScale(scale + STEP); }
          },
          '+'
        )
      )
    );
  }

  //#endregion

  // Install the geometry shim as early as this artifact materializes, then
  // apply the stored preference before the shell's first React mount, so the app
  // is never painted at the wrong scale and then corrected.
  installZoomGeometryShim();
  applyDocumentScale(currentScale);

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: PLUGIN_ID,
      factory: function (require) {
        React = require('react');

        return {
          inject: ['slots', 'locale'],
          /**
           * Client plugin body: keep the document at the remembered scale, own
           * the locale dictionaries, and contribute the General row.
           * @param {object} ctx - the plugin's client cordis context.
           */
          apply: function (ctx) {
            localeFace = ctx.locale;

            // Keep JS-visible geometry in the coordinate space CSS uses while
            // the document is zoomed (see the shim region above).
            ctx.effect(function () {
              installZoomGeometryShim();
              return uninstallZoomGeometryShim;
            }, PLUGIN_ID + ': zoom geometry shim');

            ctx.effect(function () {
              applyDocumentScale(getScale());
              return restoreDocumentScale;
            }, PLUGIN_ID + ': document scale');

            // Another tab (same origin) changed the preference: follow it.
            ctx.effect(function () {
              function onStorage(event) {
                if (!event || event.key !== STORAGE_KEY) return;
                var next = readStoredScale(STORAGE_KEY);
                if (next !== null) adoptExternalScale(next);
              }
              window.addEventListener('storage', onStorage);
              return function () {
                window.removeEventListener('storage', onStorage);
              };
            }, PLUGIN_ID + ': storage sync');

            // Ctrl(⌘)+wheel adjusts the interface zoom; the capture listener
            // also cancels the platform's own wheel zoom for this page.
            ctx.effect(function () {
              window.addEventListener('wheel', handleZoomWheel, { capture: true, passive: false });
              return function () {
                window.removeEventListener('wheel', handleZoomWheel, { capture: true });
                if (wheelResetTimer !== null) {
                  clearTimeout(wheelResetTimer);
                  wheelResetTimer = null;
                }
              };
            }, PLUGIN_ID + ': ctrl+wheel');

            ctx.effect(function () {
              return ctx.locale.register(LOCALE_NS, 'en', EN);
            }, PLUGIN_ID + ': en dictionary');
            ctx.effect(function () {
              return ctx.locale.register(LOCALE_NS, 'zh', ZH);
            }, PLUGIN_ID + ': zh dictionary');

            ctx.slots.inject('settings.general.item', function () {
              return ctx.slots.register({
                name: 'settings.general.item',
                id: 'zoom',
                order: 13,
                locale: LOCALE_NS
              }, ZoomRow);
            });

            // The at-a-glance control in the Session header's right corner.
            ctx.slots.inject('conversation.session.header.utilities', function () {
              return ctx.slots.register({
                name: 'conversation.session.header.utilities',
                id: 'zoom',
                order: 10,
                locale: LOCALE_NS
              }, HeaderZoomControl);
            });
          }
        };
      }
    });
  }
})();







