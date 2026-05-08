import { describe, it, expect } from 'vitest';
import { buildRouteGreeting, buildRouteExplanation, pickGreeting, formatPlanError } from '../nlgTemplate';

const samplePlan = {
  origin: { name: 'Tec de Monterrey' },
  destination: { name: 'Parque Fundidora' },
  totalDuration: 35,
  steps: [
    { type: 'walk' as const, from: 'Tec', to: 'Estación Y', duration: 5 },
    { type: 'transit' as const, from: 'Estación Y', to: 'Estación Z', duration: 20, routeId: 'metro-2', stopsCount: 6 },
    { type: 'walk' as const, from: 'Estación Z', to: 'Fundidora', duration: 8 },
  ],
};

describe('pickGreeting()', () => {
  it('returns a Spanish greeting for lang=es', () => {
    const g = pickGreeting('seed-1', 'es');
    expect(typeof g).toBe('string');
    expect(g.length).toBeGreaterThan(0);
    // No English word
    expect(g.toLowerCase()).not.toContain("here's");
  });

  it('returns an English greeting for lang=en', () => {
    const g = pickGreeting('seed-1', 'en');
    expect(typeof g).toBe('string');
    expect(g.length).toBeGreaterThan(0);
  });

  it('is deterministic for same seed', () => {
    expect(pickGreeting('abc', 'es')).toBe(pickGreeting('abc', 'es'));
    expect(pickGreeting('xyz', 'en')).toBe(pickGreeting('xyz', 'en'));
  });

  it('different seeds can produce different greetings (entropy check)', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const greetings = new Set(seeds.map((s) => pickGreeting(s, 'es')));
    // With 6 candidates and 10 seeds, expect at least 3 distinct.
    expect(greetings.size).toBeGreaterThanOrEqual(3);
  });
});

describe('buildRouteGreeting()', () => {
  it('includes both place names and total duration', () => {
    const msg = buildRouteGreeting(samplePlan, [], 'es', false);
    expect(msg).toContain('Tec de Monterrey');
    expect(msg).toContain('Parque Fundidora');
    expect(msg).toContain('35 min');
  });

  it('omits alternatives mention when there are none', () => {
    const msg = buildRouteGreeting(samplePlan, [], 'es', false);
    expect(msg).not.toMatch(/alternativa/i);
  });

  it('mentions alternatives count and pluralizes correctly (es)', () => {
    const oneAlt = [{ totalDuration: 40, steps: [] }];
    expect(buildRouteGreeting(samplePlan, oneAlt, 'es', false)).toMatch(/1 alternativa\b/);
    const twoAlts = [...oneAlt, { totalDuration: 50, steps: [] }];
    expect(buildRouteGreeting(samplePlan, twoAlts, 'es', false)).toMatch(/2 alternativas\b/);
  });

  it('mentions alternatives count and pluralizes correctly (en)', () => {
    const oneAlt = [{ totalDuration: 40, steps: [] }];
    expect(buildRouteGreeting(samplePlan, oneAlt, 'en', false)).toMatch(/1 alternative\b/);
    const twoAlts = [...oneAlt, { totalDuration: 50, steps: [] }];
    expect(buildRouteGreeting(samplePlan, twoAlts, 'en', false)).toMatch(/2 alternatives\b/);
  });

  it('adds taxi note when hasTransportLeg=true', () => {
    const msg = buildRouteGreeting(samplePlan, [], 'es', true);
    expect(msg).toMatch(/🚕/);
    expect(msg.toLowerCase()).toMatch(/taxi|uber|didi/);
  });

  it('omits taxi note when hasTransportLeg=false', () => {
    const msg = buildRouteGreeting(samplePlan, [], 'es', false);
    expect(msg).not.toMatch(/🚕/);
  });

  it('produces deterministic output for the same plan', () => {
    const a = buildRouteGreeting(samplePlan, [], 'es', false);
    const b = buildRouteGreeting(samplePlan, [], 'es', false);
    expect(a).toBe(b);
  });

  it('English variant uses English copy', () => {
    const msg = buildRouteGreeting(samplePlan, [], 'en', true);
    expect(msg).toMatch(/Trip from/);
    expect(msg).toMatch(/recommended/);
  });
});

describe('buildRouteExplanation()', () => {
  it('includes header + numbered steps', () => {
    const text = buildRouteExplanation(samplePlan, 'es');
    expect(text).toMatch(/35 min/);
    expect(text).toContain('1. 🚶');
    expect(text).toContain('2. 🚇');
    expect(text).toContain('3. 🚶');
  });

  it('formats metro lines correctly', () => {
    const text = buildRouteExplanation(samplePlan, 'es');
    expect(text).toContain('Metro Línea 2');
  });

  it('formats Ecovía specifically', () => {
    const plan = {
      ...samplePlan,
      steps: [
        { type: 'transit' as const, from: 'A', to: 'B', duration: 10, routeId: 'ecovia', stopsCount: 4 },
      ],
    };
    const text = buildRouteExplanation(plan, 'es');
    expect(text).toContain('Ecovía');
  });

  it('handles transfer steps', () => {
    const plan = {
      ...samplePlan,
      steps: [
        { type: 'transfer' as const, from: 'Cuauhtémoc', duration: 3 },
      ],
    };
    const text = buildRouteExplanation(plan, 'es');
    expect(text).toContain('🔄');
    expect(text).toContain('Transbordo');
  });

  it('English variant uses English step copy', () => {
    const text = buildRouteExplanation(samplePlan, 'en');
    expect(text).toContain('Walk from');
    expect(text).toContain('Take Metro Line 2');
  });
});

describe('formatPlanError()', () => {
  it('SAME_PLACE returns short copy', () => {
    expect(formatPlanError({ code: 'SAME_PLACE', message: 'x' }, 'es')).toMatch(/¡Ya estás ahí!/);
    expect(formatPlanError({ code: 'SAME_PLACE', message: 'x' }, 'en')).toMatch(/already there/i);
  });

  it('TOO_FAR with suggestion turns into an actionable recommendation', () => {
    const err = {
      code: 'TOO_FAR',
      message: 'unused',
      suggestion: {
        nearestStation: 'Estación Niños Héroes',
        stationCoords: [-100.31, 25.67] as [number, number],
        distanceKm: 4.2,
        taxiMinutes: 12,
        taxiCostMXN: 75,
      },
    };
    const es = formatPlanError(err, 'es');
    expect(es).toContain('4.2 km');
    expect(es).toContain('Estación Niños Héroes');
    expect(es).toMatch(/12 min/);
    expect(es).toMatch(/\$75 MXN/);
    expect(es.toLowerCase()).toMatch(/taxi|uber|didi/);

    const en = formatPlanError(err, 'en');
    expect(en).toMatch(/4\.2 km/);
    expect(en).toMatch(/Estación Niños Héroes/);
    expect(en).toMatch(/12 min/);
  });

  it('TOO_FAR without suggestion falls back to the message', () => {
    const err = { code: 'TOO_FAR', message: 'demasiado lejos' };
    expect(formatPlanError(err, 'es')).toBe('demasiado lejos');
  });

  it('NO_ROUTE returns guidance copy', () => {
    expect(formatPlanError({ code: 'NO_ROUTE', message: 'x' }, 'es')).toMatch(/punto de referencia/);
    expect(formatPlanError({ code: 'NO_ROUTE', message: 'x' }, 'en')).toMatch(/landmarks/i);
  });

  it('GEOCODE_ORIGIN / GEOCODE_DEST distinguish origin vs destination', () => {
    expect(formatPlanError({ code: 'GEOCODE_ORIGIN', message: 'x' }, 'es')).toMatch(/origen/i);
    expect(formatPlanError({ code: 'GEOCODE_DEST', message: 'x' }, 'es')).toMatch(/destino/i);
  });

  it('MISSING_ORIGIN suggests providing origin or GPS', () => {
    expect(formatPlanError({ code: 'MISSING_ORIGIN', message: 'x' }, 'es')).toMatch(/origen.*GPS|GPS.*origen/);
  });

  it('unknown code falls back to err.message', () => {
    expect(formatPlanError({ code: 'WHATEVER', message: 'algo pasó' }, 'es')).toBe('algo pasó');
  });
});
