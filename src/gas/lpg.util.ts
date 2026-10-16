// LPG mass-balance helpers.
//
// These mirror `@malique/shared-utils` but are kept as a local compiled module
// inside the API so the CommonJS serverless bundle has no runtime dependency on
// a TS-only workspace package (whose `main` points at `./src/index.ts`). On
// Vercel `require('@malique/shared-utils')` failed with "Cannot find module"
// during module-graph load, which crashed the whole Nest app before any request
// (even `GET /`) could be served.
export const LPG_KG_PER_LITRE = 0.54;

/** Convert a bulk tank volume in litres to an approximate mass in kg. */
export function litresToKg(litres: number): number {
  return (Number(litres) || 0) * LPG_KG_PER_LITRE;
}

/** Convert a mass in kg back to an approximate volume in litres. */
export function kgToLitres(kg: number): number {
  const d = Number(kg) || 0;
  return d / LPG_KG_PER_LITRE;
}

/**
 * Classify a reconciliation variance (as a fraction, e.g. 0.03 = 3%).
 * Anything within `warnPct` is ok; beyond `criticalPct` is critical.
 */
export function classifyVariance(
  variancePct: number,
  warnPct = 0.02,
  criticalPct = 0.05,
): 'ok' | 'warning' | 'critical' {
  const magnitude = Math.abs(Number(variancePct) || 0);
  if (magnitude >= criticalPct) return 'critical';
  if (magnitude >= warnPct) return 'warning';
  return 'ok';
}
