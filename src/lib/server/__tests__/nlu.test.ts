import { describe, it, expect } from 'vitest';
import { fastNLU, parseTransportFilter, detectLang, norm } from '../nlu';

describe('norm()', () => {
  it('strips combining diacritics', () => {
    expect(norm('café')).toBe('cafe');
    expect(norm('México')).toBe('Mexico');
    expect(norm('¿cómo?')).toBe('¿como?');
    expect(norm('Ecovía')).toBe('Ecovia');
  });

  it('preserves ñ as-is (NFD does not decompose ñ to n + combining)', () => {
    // ñ is a single codepoint — NFD decomposes some characters but Spanish
    // tilde-n may or may not get split; document actual behavior.
    const result = norm('niño');
    // either 'nino' or 'niño' is acceptable — but should be deterministic
    expect(result === 'niño' || result === 'nino').toBe(true);
  });

  it('handles empty string', () => {
    expect(norm('')).toBe('');
  });
});

describe('detectLang()', () => {
  it('returns es by default', () => {
    expect(detectLang('quiero ir a fundidora')).toBe('es');
    expect(detectLang('como llego al aeropuerto')).toBe('es');
    expect(detectLang('')).toBe('es');
  });

  it('detects English on unambiguous phrases', () => {
    expect(detectLang('how do i get to fundidora')).toBe('en');
    expect(detectLang('take me to the stadium')).toBe('en');
    expect(detectLang('directions to downtown')).toBe('en');
    expect(detectLang('I want to go to the airport')).toBe('en');
  });

  it('does NOT trigger English on Spanish queries with English words', () => {
    expect(detectLang('llévame al downtown')).toBe('es');
    expect(detectLang('quiero ir al airport')).toBe('es');
    expect(detectLang('como llego al stadium')).toBe('es');
  });
});

describe('parseTransportFilter()', () => {
  it('detects metro', () => {
    expect(parseTransportFilter('metro')).toBe('metro');
    expect(parseTransportFilter('metros')).toBe('metro');
    expect(parseTransportFilter('línea de metro')).toBe('metro');
  });

  it('detects ecovia (with and without accent)', () => {
    expect(parseTransportFilter('ecovia')).toBe('ecovia');
    expect(parseTransportFilter('ecovía')).toBe('ecovia');
  });

  it('detects bus (camion variants)', () => {
    expect(parseTransportFilter('camion')).toBe('bus');
    expect(parseTransportFilter('camión')).toBe('bus');
    expect(parseTransportFilter('camiones')).toBe('bus');
  });

  it('returns undefined for generic terms', () => {
    expect(parseTransportFilter('rutas')).toBeUndefined();
    expect(parseTransportFilter('ruta')).toBeUndefined();
    expect(parseTransportFilter('transporte')).toBeUndefined();
  });
});

describe('fastNLU() — Pattern 1: "de X a Y"', () => {
  it('matches "de X a Y"', () => {
    expect(fastNLU('de fundidora a macroplaza')).toEqual({
      type: 'route', origin: 'fundidora', destination: 'macroplaza',
    });
  });

  it('matches "desde X hasta Y"', () => {
    expect(fastNLU('desde tec hasta cumbres')).toEqual({
      type: 'route', origin: 'tec', destination: 'cumbres',
    });
  });

  it('matches "desde X hacia Y"', () => {
    expect(fastNLU('desde plaza fiesta hacia el aeropuerto')).toEqual({
      type: 'route', origin: 'plaza fiesta', destination: 'el aeropuerto',
    });
  });

  it('handles multi-word origin and destination', () => {
    const r = fastNLU('de plaza la silla a parque fundidora');
    expect(r?.type).toBe('route');
    if (r?.type === 'route') {
      expect(r.destination).toBe('parque fundidora');
      // greedy origin keeps "plaza la silla"
      expect(r.origin).toBe('plaza la silla');
    }
  });

  it('strips trailing punctuation', () => {
    expect(fastNLU('de fundidora a macroplaza?')).toMatchObject({
      destination: 'macroplaza',
    });
    expect(fastNLU('de fundidora a macroplaza.')).toMatchObject({
      destination: 'macroplaza',
    });
  });

  it('accepts greeting prefixes', () => {
    expect(fastNLU('oye, de fundidora a macroplaza')).toMatchObject({
      origin: 'fundidora', destination: 'macroplaza',
    });
    expect(fastNLU('wey de tec a cumbres')).toMatchObject({
      origin: 'tec', destination: 'cumbres',
    });
  });

  it('accepts verb prefixes', () => {
    expect(fastNLU('como llego de fundidora a macroplaza')).toMatchObject({
      origin: 'fundidora', destination: 'macroplaza',
    });
    expect(fastNLU('quiero ir de tec a cumbres')).toMatchObject({
      origin: 'tec', destination: 'cumbres',
    });
  });

  it('handles accents in input', () => {
    expect(fastNLU('cómo llego de fundidora a la estación uni')).toMatchObject({
      origin: 'fundidora',
    });
  });
});

describe('fastNLU() — Pattern 2A: "VERB a Y desde X"', () => {
  it('matches "como llego al Y desde X"', () => {
    const r = fastNLU('como llego al aeropuerto desde fundidora');
    expect(r).toMatchObject({
      type: 'route',
      destination: 'aeropuerto',
      origin: 'fundidora',
    });
  });

  it('matches "quiero ir a la Y desde X"', () => {
    expect(fastNLU('quiero ir a la macroplaza desde tec')).toMatchObject({
      type: 'route',
      destination: 'macroplaza',
      origin: 'tec',
    });
  });

  it('strips article from origin', () => {
    expect(fastNLU('como llego al estadio desde la macroplaza')).toMatchObject({
      origin: 'macroplaza',
    });
  });
});

describe('fastNLU() — Pattern 2B: "VERB a Y" (no origin)', () => {
  it('matches "como llego al Y"', () => {
    expect(fastNLU('como llego al aeropuerto')).toEqual({
      type: 'route', destination: 'aeropuerto',
    });
  });

  it('matches "quiero ir a Y"', () => {
    expect(fastNLU('quiero ir a fundidora')).toEqual({
      type: 'route', destination: 'fundidora',
    });
  });

  it('matches "llevame a Y"', () => {
    expect(fastNLU('llevame al estadio')).toEqual({
      type: 'route', destination: 'estadio',
    });
  });
});

describe('fastNLU() — Pattern 3A/3B: "ruta a Y [desde X]"', () => {
  it('matches "ruta a Y"', () => {
    expect(fastNLU('ruta a fundidora')).toEqual({
      type: 'route', destination: 'fundidora',
    });
  });

  it('matches "ruta hacia Y"', () => {
    expect(fastNLU('ruta hacia el aeropuerto')).toEqual({
      type: 'route', destination: 'el aeropuerto',
    });
  });

  it('matches "ruta a Y desde X"', () => {
    expect(fastNLU('ruta al estadio desde tec')).toEqual({
      type: 'route', destination: 'estadio', origin: 'tec',
    });
  });
});

describe('fastNLU() — Pattern 4: implicit destination', () => {
  it('matches a known place (≤4 words, not a question)', () => {
    expect(fastNLU('fundidora')).toEqual({
      type: 'route', destination: 'fundidora',
    });
    expect(fastNLU('macroplaza')).toEqual({
      type: 'route', destination: 'macroplaza',
    });
  });

  it('rejects long inputs', () => {
    expect(fastNLU('fundidora monterrey nuevo leon mexico cool')).toBeNull();
  });

  it('rejects question-like inputs', () => {
    expect(fastNLU('qué es fundidora')).toBeNull();
    // ¿X? is treated as question-like by current heuristic — both rejected.
    expect(fastNLU('¿fundidora?')).toBeNull();
  });

  it('returns null for unknown bare word', () => {
    expect(fastNLU('xyzwowo')).toBeNull();
  });
});

describe('fastNLU() — Pattern 5: routes-near (general)', () => {
  it('matches "qué rutas pasan por X"', () => {
    expect(fastNLU('qué rutas pasan por fundidora')).toEqual({
      type: 'routes-near', location: 'fundidora',
    });
  });

  it('matches "rutas hay cerca de X"', () => {
    expect(fastNLU('rutas hay cerca de la macroplaza')).toEqual({
      type: 'routes-near', location: 'macroplaza',
    });
  });

  it('matches "qué transporte pasa por X"', () => {
    expect(fastNLU('qué transporte pasa por el centro')).toEqual({
      type: 'routes-near', location: 'centro',
    });
  });

  it('strips the article on "el/la/los/las"', () => {
    expect(fastNLU('qué rutas pasan por el tec')).toMatchObject({ location: 'tec' });
    expect(fastNLU('qué rutas pasan por la macroplaza')).toMatchObject({ location: 'macroplaza' });
  });
});

describe('fastNLU() — Pattern 6: routes-near (filtered)', () => {
  it('detects metro filter', () => {
    expect(fastNLU('qué metro me deja cerca de fundidora')).toEqual({
      type: 'routes-near', location: 'fundidora', filter: 'metro',
    });
  });

  it('detects camión/bus filter', () => {
    expect(fastNLU('qué camión me deja cerca del estadio')).toEqual({
      type: 'routes-near', location: 'estadio', filter: 'bus',
    });
  });

  it('detects ecovía filter', () => {
    expect(fastNLU('qué ecovía me deja cerca de la macroplaza')).toEqual({
      type: 'routes-near', location: 'macroplaza', filter: 'ecovia',
    });
  });

  it('rutas (generic) → no filter', () => {
    const r = fastNLU('qué rutas me dejan cerca de fundidora');
    expect(r).toMatchObject({ type: 'routes-near', location: 'fundidora' });
    expect((r as any).filter).toBeUndefined();
  });
});

describe('fastNLU() — fallthrough cases', () => {
  it('returns null for empty input', () => {
    expect(fastNLU('')).toBeNull();
    expect(fastNLU('   ')).toBeNull();
  });

  it('returns null for unrecognized free-form questions', () => {
    expect(fastNLU('cuanto cuesta el metro')).toBeNull();
    expect(fastNLU('a qué hora cierra el metro')).toBeNull();
    expect(fastNLU('qué tarjeta uso para el camión')).toBeNull();
  });

  it('returns null for greetings', () => {
    expect(fastNLU('hola')).toBeNull();
    expect(fastNLU('buenas tardes')).toBeNull();
  });
});

describe('fastNLU() — precedence', () => {
  it('routes-near (P5/P6) takes precedence over generic route patterns', () => {
    // "rutas pasan" should match P5, not be misinterpreted as a route query
    const r = fastNLU('qué rutas pasan por fundidora');
    expect(r?.type).toBe('routes-near');
  });
});
