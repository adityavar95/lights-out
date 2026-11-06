// Tyre compounds: dry slicks, intermediates and full wets, their grip on dry and wet asphalt, thermal windows and the
// degradation curve. Pure functions; sim.js and strategy.js read them.

// grip: multiplier on the car's base friction; warm: heat input multiplier (fast / slow warm-up); wear: % of tyre
// health per average lap; window: surface temperature (C) of peak grip; wet: track wetness range the tread is made for;
// evac: water a tread can clear, as the speed (m/s) at which it aquaplanes on a fully flooded track.
// Dry steps are Pirelli's typical gaps, ~0.6-0.8 s a lap soft to medium and medium to hard: lap time moves ~0.47 % per
// 1 % of grip in the simulation, so each step is ~1.5 % of grip.
export const COMPOUNDS = {
  SOFT: {grip: 1.016, warm: 1.25, wear: 3.2, window: [90, 110], evac: 32},
  MEDIUM: {grip: 1.0, warm: 1.0, wear: 1.9, window: [90, 110], evac: 32},
  HARD: {grip: 0.986, warm: 0.8, wear: 1.45, window: [90, 110], evac: 32},
  INTERMEDIATE: {grip: 0.9, warm: 1.0, wear: 1.6, window: [55, 75], wet: [0.15, 0.55], evac: 60},
  WET: {grip: 0.8, warm: 0.9, wear: 1.3, window: [45, 65], wet: [0.55, 1], evac: 88},
};
export const DRY = ['SOFT', 'MEDIUM', 'HARD'];
export const isWetTyre = c => !!COMPOUNDS[c]?.wet;

// Thermal grip: a flat-topped bell, full grip inside the compound's window, falling off quadratically either side
// (for slicks ~0.87 at 75 C cold, ~0.9 at 120 C, ~0.6 at 130 C; above window + 10 C the tread blisters: double wear).
export function thermalGrip(T, [lo, hi] = [90, 110]) {
  if (T < lo) return Math.min(1, Math.max(0.55, 1 - 0.0006 * (lo - T) ** 2));
  if (T > hi) return Math.min(1, Math.max(0.55, 1 - 0.001 * (T - hi) ** 2));
  return 1;
}

// Wear grip over tyre health (100 = new): a gentle linear fade to 0.93 at 35 %, then "the cliff", an exponential collapse
// towards 0.55 as the last of the rubber goes.
export function wearGrip(h) {
  if (h >= 35) return 1 - 0.07 * (100 - h) / 65;
  return 0.93 - 0.4 * (1 - Math.exp(-3 * (35 - h) / 35));
}

// How a compound copes with track wetness w (0 = dry, 1 = flooded): {grip, heat, wear} multipliers.
//  - Slicks have no tread: water lifts them off the asphalt. Grip falls 2 %/% of wetness past 5 %, to 0.70 at 20 %
//    (the crossover: intermediates are faster from about 10-12 %), then towards 0.3 in standing water.
//  - Intermediates work in 15-55 %. On a dry track (< 15 %) nothing cools the soft, siped tread, so it overheats and
//    tears: heat up to x1.9 and wear up to x3.25 when bone dry. Past 55 % they can't clear the water and lose grip.
//  - Full wets clear the most water (they never aquaplane at racing speed) but their deep, soft blocks squirm and
//    overheat as the track dries, which makes them clearly slower than intermediates below ~65 %.
export function surfaceGrip(compound, w) {
  const c = COMPOUNDS[compound];
  if (!c.wet) {
    const grip = w <= 0.05 ? 1 : w <= 0.2 ? 1 - 2 * (w - 0.05) : Math.max(0.3, 0.7 - 0.9 * (w - 0.2));
    return {grip, heat: 1, wear: 1};
  }
  const [lo, hi] = c.wet;
  if (w < lo) {
    const dry = lo - w;
    return compound === 'WET' ? {grip: 1 - 0.35 * dry, heat: 1 + 2.2 * dry, wear: 1 + 4 * dry}
                              : {grip: 1 - 0.6 * dry, heat: 1 + 6 * dry, wear: 1 + 15 * dry};
  }
  return {grip: w > hi ? 1 - 0.8 * (w - hi) : 1, heat: 1, wear: 1};
}

// Aquaplaning: a tyre rides up on the water film once the water can't escape the contact patch in time. The critical
// speed falls as the film deepens, v_aq = evac / sqrt(w); there is no film to speak of below 8 % wetness.
export const aquaplaneSpeed = (compound, w) => (w < 0.08 ? Infinity : COMPOUNDS[compound].evac / Math.sqrt(w));

// tyre blanket temperatures for a fresh set: slicks at the 70 C limit all round (since 2022), wets run cooler
export const blankets = c => (isWetTyre(c) ? [50, 50, 45, 45] : [70, 70, 70, 70]);

// laps until a fresh set reaches the 35 % cliff at this wetness and pace (wear multiplier)
export const stintLife = (compound, w, paceWear = 1) => 65 / (COMPOUNDS[compound].wear * surfaceGrip(compound, w).wear * paceWear);
