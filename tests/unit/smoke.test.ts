import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('środowisko testowe działa', () => {
    expect(1 + 1).toBe(2);
  });

  it('ma Intl pl-PL z przecinkiem dziesiętnym', () => {
    expect(new Intl.NumberFormat('pl-PL').format(12.5)).toBe('12,5');
  });
});
