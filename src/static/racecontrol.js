// FIA race control: neutralisations (VSC, Safety Car), the DRS interlocks and the official messages. Pure.
//
// States:          GREEN --deploy VSC--> VSC --green--> VSC ENDING (10 s) --> GREEN
//                  GREEN --deploy SC---> SC  --green--> SC IN (until the leader next crosses the line) --> GREEN
// VSC: every car must keep to a delta 35 % slower than racing pace, so the field slows together and time gaps hold.
// SC:  the leader follows the safety car's pace, everyone else closes up behind and may not overtake.
// DRS is enabled only under green, on a dry track (<= 20 % wetness), from lap 3 and from the second lap after a
// safety car restart; it is disabled the moment any of those stops holding.
// drsName: what the messages call it ('OVERTAKE' from 2026, when the overtake mode replaced DRS)
export const createControl = (drsName = 'DRS') => ({state: 'GREEN', since: 0, request: null, drs: false, restartLap: -Infinity,
                                                    slippery: false, messages: [], windowStint: null, drsName});

// messages in the replay's race-control feed format: [time, category, flag, text]
const say = (C, t, text, flag = null) => C.messages.push([Math.round(t * 10) / 10, 'Race Control', flag, text]);

// what the race director asks for: 'GREEN' | 'VSC' | 'SC'
export function deploy(C, state) { C.request = state; }

// leader: the car in P1 (laps done); wetness: track average 0..1; t: race time
export function controlStep(C, dt, t, leader, wetness) {
  C.since += dt;
  const req = C.request, go = s => { C.state = s; C.since = 0; };
  C.request = null;
  if (req === 'VSC' && (C.state === 'GREEN' || C.state === 'VSC ENDING')) { go('VSC'); say(C, t, 'VIRTUAL SAFETY CAR DEPLOYED', 'YELLOW'); }
  if (req === 'SC' && C.state !== 'SC') { go('SC'); say(C, t, 'SAFETY CAR DEPLOYED', 'YELLOW'); }
  if (req === 'GREEN' && C.state === 'VSC') { go('VSC ENDING'); say(C, t, 'VSC ENDING'); }
  if (req === 'GREEN' && C.state === 'SC') { go('SC IN'); C.inLap = leader.lapsDone; say(C, t, 'SAFETY CAR IN THIS LAP'); }
  if (C.state === 'VSC ENDING' && C.since >= 10) { go('GREEN'); say(C, t, 'GREEN FLAG', 'GREEN'); }
  if (C.state === 'SC IN' && leader.lapsDone > C.inLap) {
    go('GREEN');
    C.restartLap = leader.lapsDone;
    say(C, t, 'GREEN FLAG · RACE RESUMED', 'GREEN');
  }
  if (wetness > 0.2 && !C.slippery) { C.slippery = true; say(C, t, 'TRACK SURFACE SLIPPERY'); }
  if (wetness < 0.15) C.slippery = false;  // hysteresis, so a track hovering at 20 % doesn't spam messages
  const drs = C.state === 'GREEN' && leader.lapsDone >= 2 && leader.lapsDone >= C.restartLap + 2 && wetness <= 0.2;
  if (drs !== C.drs) say(C, t, `${C.drsName} ${drs ? 'ENABLED' : 'DISABLED'}`);
  C.drs = drs;
  // pit window: called once per leader stint, when the leader's tyres are past half life
  if (leader.healthAvg < 50 && C.windowStint !== leader.stint) { C.windowStint = leader.stint; say(C, t, 'PIT WINDOW OPEN'); }
}

// pace and racing rules for the current state
export const neutralised = C => C.state !== 'GREEN';                 // no overtaking, no DRS
export const vscDelta = C => (C.state === 'VSC' || C.state === 'VSC ENDING' ? 0.65 : 1);  // 35 % slower
export const safetyCar = C => C.state === 'SC' || C.state === 'SC IN';
