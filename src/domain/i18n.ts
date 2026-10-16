const rules = new Intl.PluralRules('pl-PL');
const numberFmt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

export interface PluralForms {
  one: string;
  few: string;
  many: string;
}

/** plural(5, { one: 'zmiana', few: 'zmiany', many: 'zmian' }) → 'zmian' */
export function pluralForm(n: number, forms: PluralForms): string {
  const cat = rules.select(Math.abs(n));
  if (cat === 'one') return forms.one;
  if (cat === 'few') return forms.few;
  return forms.many; // many + other
}

/** plural(22, ...) → '22 zmiany' */
export function plural(n: number, forms: PluralForms): string {
  return `${numberFmt.format(n)} ${pluralForm(n, forms)}`;
}

export const SHIFTS = { one: 'zmiana', few: 'zmiany', many: 'zmian' } as const;
export const PEOPLE = { one: 'osoba', few: 'osoby', many: 'osób' } as const;

/** Minuty → '12,5 h' (przecinek dziesiętny). */
export function formatHours(minutes: number): string {
  return `${numberFmt.format(minutes / 60)} h`;
}
