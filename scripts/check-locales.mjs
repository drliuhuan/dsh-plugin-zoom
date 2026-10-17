#!/usr/bin/env node
/**
 * Bilingual parity check for dsh-plugin-zoom.
 *
 * The plugin ships two layers of user-facing copy, and both must stay complete
 * in the two locales the DSH Web client builds in (`LOCALE_IDS = ["zh", "en"]`):
 *
 *  1. plugin metadata read by the Plugin Manager — `locale/en.json` and
 *     `locale/zh.json` (`meta.title`, `meta.description`);
 *  2. the Client half's runtime dictionaries — the `EN` and `ZH` tables in
 *     `client.js`, registered through the DSH locale service and resolved by
 *     every visible string of the settings row and the Session-header control.
 *
 * The check fails on the cases that would show untranslated text in one
 * language: a missing locale file or entry, dictionaries that drifted apart, or
 * a `translate(...)` key the dictionaries do not contain.
 *
 * Run with `node scripts/check-locales.mjs` (also part of `npm run check`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

/** Read and parse one JSON file under the package root. */
function readJson(relativePath) {
  let text;
  try {
    text = readFileSync(join(root, relativePath), 'utf8');
  } catch (error) {
    problems.push(`${relativePath}: cannot read (${error.message})`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    problems.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

/** Flatten an object's key paths, e.g. `meta.title`. */
function keyPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.keys(value).flatMap((key) => keyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`));
}

/** Assert one `meta` field is a non-empty string in both metadata files. */
function checkMetaField(both, field) {
  for (const locale of ['en', 'zh']) {
    const value = both[locale]?.meta?.[field];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`locale/${locale}.json: meta.${field} must be a non-empty string`);
    }
  }
}

// 1. Plugin metadata (Plugin Manager title/description).
const meta = {
  en: readJson('locale/en.json'),
  zh: readJson('locale/zh.json')
};
if (meta.en !== null && meta.zh !== null) {
  const enKeys = keyPaths(meta.en).sort();
  const zhKeys = keyPaths(meta.zh).sort();
  if (enKeys.join('\n') !== zhKeys.join('\n')) {
    problems.push(`locale/en.json and locale/zh.json disagree on keys: [${enKeys.join(', ')}] vs [${zhKeys.join(', ')}]`);
  }
  checkMetaField(meta, 'title');
  checkMetaField(meta, 'description');
  notes.push(`plugin metadata: ${meta.en.meta?.title ?? '?'} / ${meta.zh.meta?.title ?? '?'}`);
}

// 2. Client runtime dictionaries.
let client = '';
try {
  client = readFileSync(join(root, 'client.js'), 'utf8');
} catch (error) {
  problems.push(`client.js: cannot read (${error.message})`);
}

/** Extract the object literal assigned to `var <name> = { ... };`. */
function dictionary(name) {
  const match = new RegExp(`var ${name} = \\{([\\s\\S]*?)\\n  \\};`).exec(client);
  if (match === null) {
    problems.push(`client.js: no ${name} dictionary literal found`);
    return null;
  }
  const keys = [...match[1].matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((entry) => entry[1]);
  return new Set(keys);
}

const enDictionary = dictionary('EN');
const zhDictionary = dictionary('ZH');
if (enDictionary !== null && zhDictionary !== null) {
  for (const key of enDictionary) {
    if (!zhDictionary.has(key)) problems.push(`client.js: ZH dictionary is missing the "${key}" key`);
  }
  for (const key of zhDictionary) {
    if (!enDictionary.has(key)) problems.push(`client.js: EN dictionary is missing the "${key}" key`);
  }
  if (enDictionary.size === 0) problems.push('client.js: EN dictionary is empty');
  notes.push(`runtime strings: EN/ZH ${enDictionary.size}/${zhDictionary.size} keys`);

  // The description interpolates the detected display scale.
  const description = /description: '([^']*)'/.exec(client);
  if (description === null || !description[1].includes('{dpi}')) {
    problems.push('client.js: the description string must interpolate {dpi} in both dictionaries');
  }

  // Both locales must be registered with the DSH locale service.
  for (const [locale, table] of [['en', 'EN'], ['zh', 'ZH']]) {
    if (!client.includes(`ctx.locale.register(LOCALE_NS, '${locale}', ${table})`)) {
      problems.push(`client.js: ${locale} is not registered with ctx.locale.register(...)`);
    }
  }
}

// 3. Every key the UI translates exists in both dictionaries.
if (enDictionary !== null && zhDictionary !== null) {
  const used = new Set([...client.matchAll(/\btranslate\('([A-Za-z0-9_]+)'/g)].map((entry) => entry[1]));
  for (const key of used) {
    if (!enDictionary.has(key)) problems.push(`client.js: translate('${key}') has no EN string`);
    if (!zhDictionary.has(key)) problems.push(`client.js: translate('${key}') has no ZH string`);
  }
  notes.push(`translated keys used by the UI: ${used.size}`);
}

// 4. The bilingual README pair exists.
for (const file of ['README.md', 'README.zh.md', 'LICENSE']) {
  try {
    if (readFileSync(join(root, file)).length === 0) problems.push(`${file}: file is empty`);
  } catch {
    problems.push(`${file}: missing`);
  }
}

// 5. Locale resources are part of the published package.
const manifest = readJson('package.json');
if (manifest !== null) {
  const exported = manifest.exports ?? {};
  if (exported['./locale/*.json'] === undefined) problems.push('package.json: exports must publish ./locale/*.json');
  const files = manifest.files ?? [];
  if (!files.includes('locale/*.json')) problems.push('package.json: files must include locale/*.json');
  if (!files.includes('README.zh.md')) problems.push('package.json: files must include README.zh.md');
}

if (problems.length > 0) {
  console.error(`bilingual check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('bilingual check passed:');
for (const note of notes) console.log(`  - ${note}`);
