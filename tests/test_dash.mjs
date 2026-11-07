// The cockpit steering wheel's screen: how far the shift lights go, and that no redraw runs before a texture wants it.
import assert from 'node:assert';
import {ledsLit, LEDS, RPM_LOW, RPM_HIGH, drawDash, dash} from '../src/static/dash.js';

assert.equal(ledsLit(0), 0);
assert.equal(ledsLit(null), 0);
assert.equal(ledsLit(RPM_LOW - 1000), 0);
assert.equal(ledsLit(RPM_HIGH), LEDS);
assert.equal(ledsLit(RPM_HIGH + 2000), LEDS);
assert.equal(ledsLit((RPM_LOW + RPM_HIGH) / 2), Math.round(LEDS / 2));
assert.equal(dash.drawn, null);
drawDash({speed: 100, gear: 3});  // no model on this page: no canvas needed, no throw
console.log('dash ok');
