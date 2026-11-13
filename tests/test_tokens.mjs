// The stylesheets' corners: every border-radius goes through a token (--r-sm / --r-md / --r-pill), 50%, 0 or inherit.
// A raw px radius outside a custom property's definition is how the app drifted to 14 different corners.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

for (const f of ['style.css', 'circuitdeck.css', 'analytics.css']) {
  const css = readFileSync(new URL(`../src/static/${f}`, import.meta.url), 'utf8');
  const raw = [...css.matchAll(/(?<![\w-])border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*([^;}]*)/g)]
    .filter(m => /(?<![\w.-])\d+(\.\d+)?px/.test(m[1])).map(m => m[0]);
  assert.deepEqual(raw, [], `${f}: raw px radius, use --r-sm, --r-md or --r-pill`);
}
console.log('tokens ok');
