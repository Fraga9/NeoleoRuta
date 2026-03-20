import routeTypes from './routeTypes.json';

// Class → [fullFare, transferFare]
const FARE_TABLE: Record<number, [number, number]> = {
  1: [9.90,  7.50],  // Metro / Ecovía
  2: [15.00, 7.50],  // Transmetro
  3: [15.00, 7.50],  // Ruta Integrada
  4: [16.50, 8.25],  // Ruta Express
};

function getRouteBase(routeId: string): string {
  return routeId.replace(/-ida$/, '').replace(/-vuelta$/, '');
}

function getRouteClass(routeId: string): number {
  const base = getRouteBase(routeId);
  return (routeTypes as Record<string, number>)[base] ?? 4; // default Express
}

/**
 * Total fare applying Me Muevo transfer integration:
 * - Leg 1: full fare
 * - Leg 2: transfer fare (50%)
 * - Leg 3+: free
 * Special rule: Metro→Metro internal transfer (class 1 → class 1) = $0,
 * does NOT count as a paid boarding (the Me Muevo counter doesn't advance).
 * linesUsed[] is ordered by boarding sequence (RAPTOR preserves order).
 */
export function calcTotalFare(linesUsed: string[]): number {
  let total = 0;
  let paidLegs = 0;
  let prevClass = -1;

  for (const id of linesUsed) {
    const cls = getRouteClass(id);
    const [full, transfer] = FARE_TABLE[cls];

    // Metro→Metro internal transfer: free, counter does not advance
    if (cls === 1 && prevClass === 1) {
      prevClass = cls;
      continue;
    }

    if (paidLegs === 0)      total += full;
    else if (paidLegs === 1) total += transfer;
    // else: 3rd+ paid leg is free

    paidLegs++;
    prevClass = cls;
  }

  return total;
}

export function formatFare(amount: number): string {
  return `$${amount.toFixed(2).replace(/\.00$/, '')}`;
}
