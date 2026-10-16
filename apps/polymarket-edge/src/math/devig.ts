export type DevigMethod = 'multiplicative' | 'power' | 'shin';

export interface DevigResult {
  fair: number[];
  overround: number;
  method: DevigMethod;
}

export function impliedProbabilities(decimalOdds: readonly number[]): number[] {
  if (decimalOdds.length < 2) throw new Error('Need at least two outcomes to de-vig');
  return decimalOdds.map((o) => {
    if (!Number.isFinite(o) || o <= 1) throw new Error(`Invalid decimal odds: ${o}`);
    return 1 / o;
  });
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function multiplicative(implied: readonly number[]): number[] {
  const total = sum(implied);
  return implied.map((p) => p / total);
}

/** Finds k such that sum(p_i^k) = 1. Shrinks longshots more than favourites. */
function power(implied: readonly number[]): number[] {
  let lo = 0.5;
  let hi = 3;
  for (let i = 0; i < 100; i++) {
    const k = (lo + hi) / 2;
    const s = sum(implied.map((p) => p ** k));
    if (s > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  return multiplicative(implied.map((p) => p ** k));
}

/** Shin (1993): models the margin as protection against insider bettors (z). */
function shin(implied: readonly number[]): number[] {
  const total = sum(implied);
  const fairFor = (z: number) =>
    implied.map((p) => (Math.sqrt(z * z + (4 * (1 - z) * p * p) / total) - z) / (2 * (1 - z)));
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 100; i++) {
    const z = (lo + hi) / 2;
    if (sum(fairFor(z)) > 1) lo = z;
    else hi = z;
  }
  return multiplicative(fairFor((lo + hi) / 2));
}

export function devig(decimalOdds: readonly number[], method: DevigMethod = 'power'): DevigResult {
  const implied = impliedProbabilities(decimalOdds);
  const overround = sum(implied) - 1;
  if (overround <= 0) {
    return { fair: multiplicative(implied), overround, method: 'multiplicative' };
  }
  const fair = method === 'multiplicative' ? multiplicative(implied) : method === 'shin' ? shin(implied) : power(implied);
  return { fair, overround, method };
}
