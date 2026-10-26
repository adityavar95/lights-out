// The HUD's consoles, set up and updated together: pit wall, driver deck, audio deck, circuit selector, car showroom,
// telemetry trace.
import {setupPitwall, updatePitwall} from './pitwall.js';
import {setupDriverDeck, updateDriverDeck} from './driverdeck.js';
import {setupAudioDeck, updateAudioDeck} from './audiodeck.js';
import {setupCircuitDeck} from './circuitdeck.js';
import {setupCarsDeck} from './carsdeck.js';
import {setupTrace, updateTrace} from './tracemodal.js';

// stage: the 3D stage; hud: setupHud's containers; getS: () => the replay state; controls: {togglePlay}
export function setupDecks(stage, hud, getS, controls) {
  setupPitwall(stage, getS);
  setupDriverDeck(hud.left, getS);
  setupAudioDeck(hud.deck, stage, getS);
  setupCircuitDeck(stage, hud.top, getS);
  setupCarsDeck(stage, hud.top);
  setupTrace(stage, hud.deck, getS, controls);
}

// every frame; focus: the focused car's HUD readings
export function updateDecks(S, st, focus) {
  updatePitwall(S);
  updateDriverDeck(S);
  updateAudioDeck(S, st, focus);
  updateTrace(S);
}
