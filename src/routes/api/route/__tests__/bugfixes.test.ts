/**
 * Regression tests for fixed bugs in /api/route.
 *
 * These are static-source assertions: they read the handler source and verify
 * known bug patterns are absent. Lightweight, fast, and protect against
 * accidental reintroduction during future edits.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const handlerPath = fileURLToPath(new URL('../+server.ts', import.meta.url));
const source = readFileSync(handlerPath, 'utf8');

describe('Bug 1: 500m/800m radius mismatch', () => {
  it('does not say "500m" anywhere in user-facing copy', () => {
    expect(source).not.toMatch(/radio\s+de\s+500m/);
    expect(source).not.toMatch(/radio\s+500m/);
    expect(source).not.toMatch(/\b500m\b/);
  });

  it('declares ROUTES_NEAR_RADIUS_M as a single source of truth', () => {
    expect(source).toMatch(/const\s+ROUTES_NEAR_RADIUS_M\s*=\s*800\b/);
  });

  it('user-facing copy interpolates the constant, not a hardcoded number', () => {
    // Match: `radio ${ROUTES_NEAR_RADIUS_M}m` or `radio de ${ROUTES_NEAR_RADIUS_M}m`
    expect(source).toMatch(/radio[^`]*\$\{ROUTES_NEAR_RADIUS_M\}m/);
  });
});

describe('Bug 2: silent MTY-center fallback when origin missing', () => {
  it('no longer hardcodes MTY center coords as origin fallback in clarification', () => {
    // The exact coordinates that used to be silently used:
    expect(source).not.toMatch(/originCoords\s*=\s*pi\.originCoords\s*\|\|\s*userLocation\s*\|\|\s*\[-100\.3161,\s*25\.6866\]/);
  });

  it('emits an explicit MISSING_ORIGIN error when origin is missing and no GPS', () => {
    expect(source).toMatch(/MISSING_ORIGIN/);
    expect(source).toMatch(/Necesito saber desde dónde sales/);
  });
});
