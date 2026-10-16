import type { Person } from '../domain/types';

/**
 * Normalizacja imion do porównań (P-17): małe litery po polsku, NFD bez znaków diakrytycznych
 * ORAZ ręcznie ł→l (ł nie rozkłada się w NFD), bez kropek i podwójnych spacji.
 */
export function normalizeName(s: string): string {
  return s
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:()"'’`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokeny nazwy bez kolejności: „Nowak K.” i „K. Nowak” dają ten sam zbiór. */
export function nameTokens(s: string): string[] {
  return normalizeName(s).split(' ').filter(Boolean);
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Zgodność zbiorów tokenów z obsługą inicjałów („k” pasuje do „katarzyna”). */
function tokenSetScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const used = new Set<number>();
  let total = 0;
  for (const ta of a) {
    let best = 0;
    let bestIdx = -1;
    b.forEach((tb, idx) => {
      if (used.has(idx)) return;
      const initial =
        (ta.length === 1 && tb.startsWith(ta)) || (tb.length === 1 && ta.startsWith(tb));
      const score = initial ? 0.96 : jaroWinkler(ta, tb);
      if (score > best) {
        best = score;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  // kara za nadmiarowe tokeny po którejś stronie
  const denom = Math.max(a.length, b.length);
  return total / denom;
}

export type MatchHow = 'exact' | 'alias' | 'fuzzy' | 'none';

export interface NameMatch {
  personId?: string;
  score: number;
  how: MatchHow;
  /** drugi najlepszy kandydat — pozwala wykryć niejednoznaczność */
  runnerUp?: { personId: string; score: number };
}

/** Progi (plan 4.6, punkt 5): ≥ AUTO dopasowanie pewne, ≥ SUGGEST podpowiedź do potwierdzenia. */
export const MATCH_AUTO = 0.93;
export const MATCH_SUGGEST = 0.8;

type MatchTarget = Pick<Person, 'id' | 'firstName' | 'lastName' | 'aliases'>;

/** Dopasowanie imienia z grafiku do znanych osób: dokładne → alias → rozmyte. */
export function matchPerson(written: string, people: MatchTarget[]): NameMatch {
  const w = normalizeName(written);
  if (!w) return { score: 0, how: 'none' };
  const wTokens = nameTokens(written);

  // 1. dokładne: pełne imię i nazwisko, w dowolnej kolejności; samo imię tylko, gdy jednoznaczne
  const exact = people.filter((p) => {
    const full = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return normalizeName(full) === w || sameTokenSet(nameTokens(full), wTokens);
  });
  if (exact.length === 1) return { personId: exact[0]!.id, score: 1, how: 'exact' };

  const firstOnly = people.filter((p) => normalizeName(p.firstName) === w);
  if (firstOnly.length === 1 && exact.length === 0) {
    return { personId: firstOnly[0]!.id, score: 1, how: 'exact' };
  }

  // 2. alias
  const byAlias = people.filter((p) => p.aliases.some((a) => normalizeName(a) === w));
  if (byAlias.length === 1) return { personId: byAlias[0]!.id, score: 1, how: 'alias' };

  // 3. rozmyte: najlepszy wynik spośród imienia, pełnej nazwy i aliasów
  const scored = people
    .map((p) => {
      const full = [p.firstName, p.lastName].filter(Boolean).join(' ');
      const candidates = [full, p.firstName, ...p.aliases];
      let best = 0;
      for (const c of candidates) {
        const cn = normalizeName(c);
        const s = Math.max(jaroWinkler(w, cn), tokenSetScore(wTokens, nameTokens(c)));
        if (s > best) best = s;
      }
      return { id: p.id, score: best };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  // kilka osób pasujących identycznie dobrze (np. dwie „Anna”) = brak pewnego wyniku
  const ambiguous = exact.length > 1 || firstOnly.length > 1 || byAlias.length > 1;
  if (!top || top.score < MATCH_SUGGEST) return { score: top?.score ?? 0, how: 'none' };
  return {
    personId: top.id,
    score: ambiguous ? Math.min(top.score, MATCH_SUGGEST) : top.score,
    how: 'fuzzy',
    runnerUp:
      second && second.score >= MATCH_SUGGEST
        ? { personId: second.id, score: second.score }
        : undefined,
  };
}

function sameTokenSet(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const sa = [...a].sort().join(' ');
  const sb = [...b].sort().join(' ');
  return sa === sb;
}
