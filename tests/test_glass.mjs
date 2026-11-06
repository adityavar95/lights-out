// Liquid Glass maps (src/static/glass.js): the lens pulls inward near the rim and leaves the middle alone; the rim is a
// valid 9-slice, lit on the top and left, dark on the corners between.
import assert from 'node:assert';
import {lensMap, rimMap} from '../src/static/glass.js';

const W = 200, H = 100, at = (x, y) => (y * W + x) * 4;
const map = lensMap(W, H, 20), across = (x, y) => map[at(x, y)], down = (x, y) => map[at(x, y) + 1];
assert.equal(map.length, W * H * 4);
// the dead centre: no pull either way
assert.ok(Math.abs(across(100, 50) - 128) <= 1 && Math.abs(down(100, 50) - 128) <= 1);
// the left rim shows what's to its right (lighter), the right rim what's to its left (darker); likewise top and bottom
assert.ok(across(5, 50) > 128 && across(194, 50) < 128, `${across(5, 50)} ${across(194, 50)}`);
assert.ok(down(100, 5) > 128 && down(100, 94) < 128, `${down(100, 5)} ${down(100, 94)}`);
// outside the rounded corner, none; and on a panel past the band's reach, the middle is left alone
assert.equal(across(0, 0), 128);
assert.ok(Math.abs(lensMap(400, 400, 14)[(100 * 400 + 200) * 4 + 1] - 128) <= 1);

const dark = [255, 255, 255, .08];
const r = rimMap(14, .13, 1, dark), side = r.size, alpha = (x, y) => r.data[(y * side + x) * 4 + 3];
assert.equal(r.slice, 14);
assert.equal(side, 30);
assert.equal(r.data.length, side * side * 4);
const mid = side >> 1;
for (const [x, y] of [[0, mid], [mid, 0], [side - 1, mid], [mid, side - 1]]) assert.ok(alpha(x, y) > 20, `lit side ${x},${y}: ${alpha(x, y)}`);
assert.equal(alpha(mid, mid), 0);  // no light in the middle
// the top-left corner catches the light, the top-right is nearly only the hairline
const onCorner = 14 - Math.round(14 * Math.SQRT1_2);
assert.ok(alpha(onCorner, onCorner) > alpha(side - 1 - onCorner, onCorner), 'lit corner beats the far one');
assert.ok(alpha(0, 0) === 0, 'outside the corner');
// a pill smaller than the light's width still draws a sound slice
assert.equal(rimMap(0, .3, 2, [0, 0, 0, .08]).slice, 3);
// a fractional device pixel ratio still gives a whole-pixel image (Windows at 125 %)
const frac = rimMap(14, .13, 1.25, dark);
assert.equal(frac.data.length, frac.size * frac.size * 4);
assert.ok(Number.isInteger(frac.size));

console.log('glass ok');
