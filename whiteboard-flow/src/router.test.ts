import { describe, expect, it } from 'vitest';
import { parseHashRoute } from './router';

describe('hash router', () => {
  it('routes empty or root hash to landing page', () => {
    expect(parseHashRoute('')).toBe('landing');
    expect(parseHashRoute('#/')).toBe('landing');
    expect(parseHashRoute('#')).toBe('landing');
  });

  it('routes #/editor directly to editor', () => {
    expect(parseHashRoute('#/editor')).toBe('editor');
    expect(parseHashRoute('#editor')).toBe('editor');
  });
});
