// Turns the single-file build (dist-single/index.html) into an artifact page:
// the host wraps the page in its own document skeleton, so this keeps the
// title first, then the font stylesheet, the inlined CSS, the app root and the
// inlined script, with no doctype, html, head or body tags.
//
//   npm run build:single && node tools/artifact.mjs <out.html>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] ?? 'dist-artifact/nailed-sun.html';
const html = readFileSync('dist-single/index.html', 'utf8');

const pick = (re, what) => {
  const all = [...html.matchAll(re)].map((m) => m[0]);
  if (!all.length) throw new Error(`No ${what} found in the build`);
  return all;
};

const title = pick(/<title>[\s\S]*?<\/title>/g, 'title')[0];
const fonts = pick(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/g, 'font stylesheet');
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g, 'style');
const scripts = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/g, 'script');

const page = [
  // The host declares UTF-8 itself; this keeps any other server from misreading the page.
  '<meta charset="utf-8">',
  title,
  '<meta name="description" content="A Total War-style strategy game under a sun that stopped moving a thousand years ago.">',
  ...fonts,
  ...styles,
  '<div id="app"></div>',
  ...scripts.map((s) => s.replace(/ crossorigin(="[^"]*")?/, '')),
].join('\n');

if (page.slice(0, 8192).indexOf('<title>') < 0) throw new Error('Title must be in the first 8 KB');
for (const tag of ['<!doctype', '<html', '<head>', '<body']) {
  if (page.slice(0, 20000).toLowerCase().includes(tag)) throw new Error(`Page must not contain ${tag}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`${out}: ${(page.length / 1024 / 1024).toFixed(2)} MB`);
