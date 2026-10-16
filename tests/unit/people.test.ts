import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { displayNames, initials, nextColor, PERSON_COLORS } from '../../src/domain/people';
import { GrafikDB, uuid } from '../../src/db/db';
import { createRepos } from '../../src/db/repos';
import { DEFAULT_HOURS } from '../../src/domain/hours';
import { exportBackup, importBackup } from '../../src/db/backup';
import type { Shift } from '../../src/domain/types';

const P = (id: string, firstName: string, lastName?: string) => ({ id, firstName, lastName });

describe('displayNames (E-29)', () => {
  it('unikalne imiona bez zmian', () => {
    const m = displayNames([P('1', 'Anna'), P('2', 'Jan')]);
    expect(m.get('1')).toBe('Anna');
    expect(m.get('2')).toBe('Jan');
  });
  it('te same imiona → inicjał nazwiska', () => {
    const m = displayNames([P('1', 'Anna', 'Kowalska'), P('2', 'anna', 'Nowak'), P('3', 'Jan')]);
    expect(m.get('1')).toBe('Anna K.');
    expect(m.get('2')).toBe('anna N.');
    expect(m.get('3')).toBe('Jan');
  });
  it('ten sam inicjał → pełne nazwisko', () => {
    const m = displayNames([P('1', 'Anna', 'Kowalska'), P('2', 'Anna', 'Kowal')]);
    expect(m.get('1')).toBe('Anna Kowalska');
    expect(m.get('2')).toBe('Anna Kowal');
  });
  it('bez nazwisk → numeracja', () => {
    const m = displayNames([P('1', 'Anna'), P('2', 'Anna'), P('3', 'Anna')]);
    expect([m.get('1'), m.get('2'), m.get('3')]).toEqual(['Anna', 'Anna (2)', 'Anna (3)']);
  });
  it('polskie litery w inicjałach', () => {
    expect(initials({ firstName: 'łukasz', lastName: 'żółć' })).toBe('ŁŻ');
    expect(initials({ firstName: 'Ola' })).toBe('O');
  });
});

describe('nextColor', () => {
  it('pierwszy wolny, potem rotacja', () => {
    expect(nextColor([])).toBe('blue');
    expect(nextColor(['blue', 'green'])).toBe('orange');
    expect(nextColor([...PERSON_COLORS])).toBe('blue');
  });
});

describe('godziny domyślne: aktualizacja przyszłych zmian', () => {
  const mk = (personId: string, date: string, p: Partial<Shift> = {}): Shift => ({
    id: uuid(),
    personId,
    date,
    kind: 'work',
    start: '10:00',
    end: '22:00',
    usesDefaultHours: true,
    source: 'manual',
    updatedAt: 0,
    ...p,
  });

  it('zmienia tylko przyszłe z flagą; historia i nadpisane godziny bez zmian', async () => {
    const db = new GrafikDB(`t-${uuid()}`);
    const repos = createRepos(db);
    const a = await repos.persons.create({ firstName: 'Ania', color: 'blue' });
    const past = mk(a.id, '2026-10-05'); // pon
    const fut = mk(a.id, '2026-11-09'); // pon
    const custom = mk(a.id, '2026-11-10', {
      start: '12:00',
      end: '18:00',
      usesDefaultHours: false,
    });
    await repos.shifts.addMany([past, fut, custom]);

    const defaults = { ...DEFAULT_HOURS, 1: { start: '09:00', end: '21:00' } };
    expect(await repos.shifts.futureUsingDefaults('2026-11-01')).toHaveLength(1);
    const n = await repos.shifts.applyDefaultHours('2026-11-01', defaults);
    expect(n).toBe(1);
    expect((await db.shifts.get(past.id))?.start).toBe('10:00');
    expect((await db.shifts.get(fut.id))?.start).toBe('09:00');
    expect((await db.shifts.get(fut.id))?.end).toBe('21:00');
    expect((await db.shifts.get(custom.id))?.start).toBe('12:00');
  });
});

describe('onboardingDone a kopia zapasowa', () => {
  it('nie trafia do eksportu; import kopii oznacza onboarding jako ukończony', async () => {
    const db = new GrafikDB(`t-${uuid()}`);
    const repos = createRepos(db);
    await repos.persons.create({ firstName: 'Ania', color: 'blue', isMe: true });
    await repos.settings.update({ onboardingDone: true });
    const b = await exportBackup(db);
    expect(JSON.stringify(b)).not.toContain('onboardingDone');

    const fresh = new GrafikDB(`t-${uuid()}`);
    await importBackup(b, 'replace', fresh);
    expect((await createRepos(fresh).settings.get()).onboardingDone).toBe(true);
  });
});
