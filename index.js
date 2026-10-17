/**
 * @fileoverview Host half of `dsh-plugin-zoom`.
 *
 * The plugin is a presentation-only feature: the whole interface scale is
 * applied in the browser (the Client half sets a CSS `zoom` on the document
 * root), so the Host half owns no service, no tool, and no persistence. It
 * exists because every Loader row needs an activatable module, and because the
 * bundle manifest resolves the Client artifact through this package's entry.
 *
 * Keeping it empty is deliberate: the Host must not read or write anything for
 * a per-browser preference, and a row with no resources has nothing to clean up
 * on unload.
 *
 * @returns {void}
 */
export function apply() {}

