import { describe, expect, it } from 'vitest';
import { surfacePaths } from './surface';
import { registrationLink } from '@/services/registration-link';

describe('surface paths', () => {
  it('keeps the app routes', () => {
    const app = surfacePaths(false);
    expect(app.home).toBe('/home');
    expect(app.registrations).toBe('/my-registrations');
    expect(app.registrationForm('exh-1')).toBe('/registration-form/exh-1');
    expect(app.registrationDetail('reg-1')).toBe('/registration-detail/reg-1');
  });

  it('uses the join routes', () => {
    const join = surfacePaths(true);
    expect(join.home).toBe('/mine');
    expect(join.registrations).toBe('/mine');
    expect(join.registrationForm('exh-1')).toBe('/e/exh-1');
    expect(join.registrationDetail('reg/1')).toBe('/mine/reg%2F1');
  });
});

describe('registration link', () => {
  it('appends the exhibition id to the configured origin', () => {
    expect(registrationLink('https://app.example.com/', 'exh-1')).toBe('https://app.example.com/e/exh-1');
  });

  it('returns empty when the public origin is missing or not a URL', () => {
    expect(registrationLink('', 'exh-1')).toBe('');
    expect(registrationLink('app.example.com', 'exh-1')).toBe('');
    expect(registrationLink('https://app.example.com', '')).toBe('');
  });
});
