// app.js's static import graph stays free of three.js: the 3D stage (replay.js, globe.js, carsdeck.js) comes in by import()
// only when a view needs it (modernize phase 3), so a link to Results or Stream never pulls ~5 MB of 3D code and its textures.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replayKind, REPLAY_KINDS} from '../src/static/util.js';

const dir = new URL('../src/static/', import.meta.url), seen = new Set(), three = [];
const walk = f => {
  if (seen.has(f)) return;
  seen.add(f);
  const src = readFileSync(new URL(f, dir), 'utf8');
  if (/^import[^(]*from 'three/m.test(src)) three.push(f);
  for (const [, dep] of src.matchAll(/^import[^'"(]*['"]\.\/([^'"]+)['"]/gm)) walk(dep);
};
walk('app.js');
assert.deepEqual(three, [], `app.js statically reaches three.js through ${three}`);
assert.ok(!seen.has('replay.js') && !seen.has('scene3d.js'));

// moved from replay.js so the race list can tag races without the stage
assert.equal(replayKind(2024, '2024-03-02'), 'gps');
assert.equal(replayKind(2010, '2010-03-14'), 'laps');
assert.equal(replayKind(1990, '1990-03-11'), 'results');
assert.equal(replayKind(2099, '2099-01-01'), null);
assert.ok(REPLAY_KINDS.gps && REPLAY_KINDS.laps && REPLAY_KINDS.results);
console.log('ok');
