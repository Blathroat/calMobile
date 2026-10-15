import { describe, expect, it } from 'vitest';
import { surfacePaths } from './surface';
import { meetingLink, registrationLink } from '@/services/registration-link';

describe('surface paths', () => {
  it('keeps the app routes', () => {
    const app = surfacePaths(false);
    expect(app.home).toBe('/home');
    expect(app.registrations).toBe('/my-registrations');
    expect(app.registrationForm('exh-1')).toBe('/registration-form/exh-1');
    expect(app.registrationDetail('reg-1')).toBe('/registration-detail/reg-1');
    expect(app.meetingDetail('meet-1')).toBe('/meeting-detail/meet-1');
    expect(app.meetingApply('usr-2')).toBe('/meeting-apply/usr-2');
  });

  it('uses the join routes', () => {
    const join = surfacePaths(true);
    expect(join.home).toBe('/mine');
    expect(join.registrations).toBe('/mine');
    expect(join.registrationForm('exh-1')).toBe('/e/exh-1');
    expect(join.registrationDetail('reg/1')).toBe('/mine/reg%2F1');
    expect(join.meetingDetail('meet/1')).toBe('/mine/m/meet%2F1');
    expect(join.meetingApply('usr-2')).toBe('/m/usr-2');
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

  it('builds the private meeting link the same way', () => {
    expect(meetingLink('https://app.example.com/', 'usr-2')).toBe('https://app.example.com/m/usr-2');
    expect(meetingLink('', 'usr-2')).toBe('');
  });
});
