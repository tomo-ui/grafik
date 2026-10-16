import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check } from 'lucide-react';
import {
  Alert,
  Button,
  GroupedList,
  ListRow,
  SegmentedControl,
  Sheet,
  Toggle,
  useBackClose,
} from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { shiftYM, type NormalizedEntry, type NormalizedPerson } from '../../ai/normalize';
import {
  blockers,
  buildImportPlan,
  conflictPolicy,
  hasBlockers,
  type ConflictMode,
  type EntryEdit,
  type ImportDecisions,
} from '../../ai/importPlan';
import { slotKey } from '../../domain/conflicts';
import { defaultHoursFor } from '../../domain/hours';
import { formatDayLong, KOLIZJE, plural, SHIFTS } from '../../domain/i18n';
import { KIND_SHORT, shiftLabel } from '../../domain/labels';
import { displayNames, fullName, nextColor } from '../../domain/people';
import type { Person, Shift, ShiftKind } from '../../domain/types';
import { TimeField } from '../settings/HoursEditor';
import { ImageViewer } from './ImageViewer';
import { useScan } from './ScanProvider';
import styles from './Scan.module.css';

const MONTHS = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
];

const KIND_OPTIONS: { value: ShiftKind; label: string }[] = [
  { value: 'work', label: 'Praca' },
  { value: 'off', label: 'Wolne' },
  { value: 'vacation', label: 'Urlop' },
  { value: 'sick', label: 'L4' },
];

// stałe referencje — nie psują zależności useMemo, gdy dane jeszcze się ładują
const NO_PERSONS: Person[] = [];
const NO_SHIFTS: Shift[] = [];

const compactHour = (t: string) => {
  const [h, m] = t.split(':');
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`;
};

/** Zastosowanie edycji do wpisu na potrzeby wyświetlania (także wpisy usunięte). */
function viewEntry(p: NormalizedPerson, e: NormalizedEntry, d: ImportDecisions) {
  const conflict = p.conflicts.find((c) => c.date === e.date);
  const base = conflict && d.entryChoice[`${p.key}|${e.date}`] === 'second' ? conflict.second : e;
  const edit: EntryEdit = d.entryEdits[base.id] ?? d.entryEdits[e.id] ?? {};
  const kind = edit.kind ?? base.kind;
  const work = kind === 'work';
  const merged: NormalizedEntry = {
    ...base,
    kind,
    start: work ? (edit.start ?? base.start) : undefined,
    end: work ? (edit.end ?? base.end) : undefined,
    usesDefaultHours: work ? (edit.usesDefaultHours ?? base.usesDefaultHours) : false,
    date:
      d.periodShift.years || d.periodShift.months
        ? shiftYM(base.date, d.periodShift.years, d.periodShift.months)
        : base.date,
  };
  return { entry: merged, removed: !!edit.removed, editKey: base.id };
}

/** Ekran weryfikacji importu (4.7): okres, osoby, dni, ostrzeżenia, kolizje, miniatura. */
export function ReviewScreen() {
  const s = useScan();
  const review = s.review!;
  const { normalized, decisions } = review;
  const persons = usePersons(true) ?? NO_PERSONS;
  const names = useMemo(() => displayNames(persons), [persons]);

  const [viewer, setViewer] = useState(false);
  const [picking, setPicking] = useState<string | null>(null); // klucz osoby z grafiku
  const [editing, setEditing] = useState<{
    key: string;
    entry: NormalizedEntry;
    editKey: string;
  } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [guard, setGuard] = useState(0);
  const importLock = useRef(false);

  // P-15: systemowe „wstecz” pyta o odrzucenie wyniku, zamiast wychodzić z aplikacji
  useBackClose(true, () => setConfirmDiscard(true), guard);

  const blk = useMemo(() => blockers(normalized, decisions), [normalized, decisions]);

  /* kolizje z istniejącymi zmianami (podgląd planu) */
  const dates = normalized.persons.flatMap((p) => p.entries.map((e) => e.date)).sort();
  const from = dates.length ? `${Number(dates[0]!.slice(0, 4)) - 1}-01-01` : '2000-01-01';
  const to = dates.length
    ? `${Number(dates[dates.length - 1]!.slice(0, 4)) + 1}-12-31`
    : '2000-01-01';
  const existing = useLiveQuery(() => repos.shifts.range(from, to), [from, to]) ?? NO_SHIFTS;

  const plan = useMemo(() => {
    let n = 0;
    return buildImportPlan(normalized, decisions, {
      persons,
      existing,
      newId: () => `preview${n++}`,
      now: 0,
      batchId: 'preview',
      pickColor: nextColor,
    });
  }, [normalized, decisions, persons, existing]);

  const policy = conflictPolicy(decisions);
  const willSkip = plan.conflicts.filter((c) => policy(c.incoming) === 'skip').length;
  const toImport = plan.shifts.length - willSkip;

  const set = (fn: (d: ImportDecisions) => ImportDecisions) => s.updateDecisions(fn);
  const setPerson = (key: string, dec: ImportDecisions['persons'][string]) =>
    set((d) => ({ ...d, persons: { ...d.persons, [key]: dec } }));
  const setEdit = (id: string, patch: EntryEdit) =>
    set((d) => ({
      ...d,
      entryEdits: { ...d.entryEdits, [id]: { ...d.entryEdits[id], ...patch } },
    }));

  /* okres */
  const det = normalized.period;
  const shiftedPeriod = det
    ? (() => {
        const idx =
          det.year * 12 +
          (det.month - 1) +
          decisions.periodShift.months +
          decisions.periodShift.years * 12;
        return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
      })()
    : null;
  const changePeriod = (year: number, month: number) => {
    if (!det) return;
    const months = year * 12 + (month - 1) - (det.year * 12 + (det.month - 1));
    set((d) => ({ ...d, periodShift: { years: 0, months } }));
  };
  const yearOptions = shiftedPeriod
    ? [shiftedPeriod.year - 1, shiftedPeriod.year, shiftedPeriod.year + 1]
    : [];

  const doImport = async () => {
    if (importLock.current || hasBlockers(blk) || toImport <= 0) return;
    importLock.current = true;
    try {
      await s.importNow();
    } finally {
      importLock.current = false;
    }
  };

  const reasons: string[] = [];
  const nameOf = (k: string) => normalized.persons.find((p) => p.key === k)?.nameAsWritten ?? k;
  if (blk.unresolved.length)
    reasons.push(`Rozstrzygnij osoby: ${blk.unresolved.map(nameOf).join(', ')}`);
  if (blk.duplicate.length)
    reasons.push(`Ta sama osoba wybrana kilka razy: ${blk.duplicate.map(nameOf).join(', ')}`);
  if (blk.entryConflicts.length)
    reasons.push(`Wybierz właściwy wpis: ${blk.entryConflicts.map(nameOf).join(', ')}`);
  if (blk.invalid.length) reasons.push(`Popraw godziny: ${blk.invalid.map(nameOf).join(', ')}`);

  const decisionLabel = (key: string) => {
    const dec = decisions.persons[key];
    if (!dec) return { text: 'Nie rozpoznano — wybierz osobę', cls: styles.matchBad };
    if (dec.mode === 'skip') return { text: 'Pomijana', cls: styles.matchWarn };
    if (dec.mode === 'new')
      return {
        text: `Nowa osoba: ${[dec.firstName, dec.lastName].filter(Boolean).join(' ')}`,
        cls: styles.matchOk,
      };
    const p = persons.find((x) => x.id === dec.personId);
    const name = p ? fullName(p) : '?';
    return dec.confirmed
      ? { text: `→ ${name} ✓`, cls: styles.matchOk }
      : { text: `Czy to ${name}? Potwierdź`, cls: styles.matchWarn };
  };

  return (
    <div
      className={styles.review}
      role="dialog"
      aria-modal="true"
      aria-label="Weryfikacja importu"
      data-testid="review"
    >
      <header className={styles.reviewBar}>
        <button type="button" className={styles.barBtn} onClick={() => setConfirmDiscard(true)}>
          Anuluj
        </button>
        <h1 className={styles.reviewTitle}>Weryfikacja</h1>
        <span style={{ minWidth: 72 }} />
      </header>

      <div className={styles.reviewBody}>
        <GroupedList header="Okres i zdjęcie">
          <div className={styles.thumbRow}>
            <button
              type="button"
              className={styles.reviewThumb}
              aria-label="Powiększ zdjęcie"
              onClick={() => setViewer(true)}
            >
              <img src={review.thumb} alt="Miniatura zdjęcia grafiku" />
            </button>
            {shiftedPeriod ? (
              <div className={styles.selects}>
                <select
                  aria-label="Miesiąc grafiku"
                  value={shiftedPeriod.month}
                  onChange={(e) => changePeriod(shiftedPeriod.year, Number(e.target.value))}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Rok grafiku"
                  value={shiftedPeriod.year}
                  onChange={(e) => changePeriod(Number(e.target.value), shiftedPeriod.month)}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span>Okres nie został wykryty</span>
            )}
          </div>
        </GroupedList>

        {hasBlockers(blk) && (
          <div className={styles.summaryErr} role="status">
            <strong>Do rozstrzygnięcia przed importem:</strong>
            <ul>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {normalized.persons.map((p) => (
          <PersonSection
            key={p.key}
            person={p}
            decisions={decisions}
            label={decisionLabel(p.key)}
            red={blk.unresolved.includes(p.key) || blk.duplicate.includes(p.key)}
            persons={persons}
            onPick={() => setPicking(p.key)}
            onConfirm={() => {
              const dec = decisions.persons[p.key];
              if (dec?.mode === 'existing') setPerson(p.key, { ...dec, confirmed: true });
            }}
            onNewName={(first, last) =>
              setPerson(p.key, { mode: 'new', firstName: first, lastName: last })
            }
            onEntry={(entry, editKey) => setEditing({ key: p.key, entry, editKey })}
            onChoice={(date, v) =>
              set((d) => ({ ...d, entryChoice: { ...d.entryChoice, [`${p.key}|${date}`]: v } }))
            }
          />
        ))}

        {(normalized.warnings.length > 0 || normalized.excluded.length > 0) && (
          <GroupedList header="Ostrzeżenia">
            <ul className={styles.warnList} data-testid="warnings">
              {normalized.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
              {normalized.excluded.map((x, i) => (
                <li key={i}>
                  Pominięto: {x.person}, {x.date}
                  {x.rawCell ? ` („${x.rawCell}”)` : ''} — {x.reason}
                </li>
              ))}
            </ul>
          </GroupedList>
        )}

        {plan.conflicts.length > 0 && (
          <GroupedList
            header={`Kolizje z istniejącymi zmianami · ${plural(plan.conflicts.length, KOLIZJE)}`}
            footer="Te osoby mają już wpisy w tych dniach."
          >
            <div className={styles.segWrap}>
              <SegmentedControl<ConflictMode>
                label="Rozwiązywanie kolizji"
                value={decisions.conflictMode}
                onChange={(m) => set((d) => ({ ...d, conflictMode: m }))}
                options={[
                  { value: 'replace', label: 'Zastąp' },
                  { value: 'skip', label: 'Pomiń' },
                  { value: 'ask', label: 'Pytaj' },
                ]}
              />
            </div>
            {decisions.conflictMode === 'ask' &&
              plan.conflicts.map((c) => {
                const key = slotKey(c.incoming);
                const person = persons.find((x) => x.id === c.incoming.personId);
                return (
                  <div key={key} className={styles.conflictRow} data-testid="conflict-row">
                    <span>
                      <strong>{person ? names.get(person.id) : '?'}</strong>,{' '}
                      {formatDayLong(c.incoming.date)}:
                      <br />
                      jest {shiftLabel(c.existing)} → nowa {shiftLabel(c.incoming)}
                    </span>
                    <SegmentedControl<'replace' | 'skip'>
                      label={`Kolizja ${key}`}
                      value={decisions.perConflict[key] ?? 'skip'}
                      onChange={(v) =>
                        set((d) => ({ ...d, perConflict: { ...d.perConflict, [key]: v } }))
                      }
                      options={[
                        { value: 'replace', label: 'Zastąp' },
                        { value: 'skip', label: 'Pomiń' },
                      ]}
                    />
                  </div>
                );
              })}
          </GroupedList>
        )}
      </div>

      <footer className={styles.reviewFoot}>
        {hasBlockers(blk) && <p className={styles.footHint}>{reasons[0]}</p>}
        <Button
          onClick={() => void doImport()}
          disabled={hasBlockers(blk) || s.importing || toImport <= 0}
        >
          {toImport > 0 ? `Importuj ${plural(toImport, SHIFTS)}` : 'Brak zmian do zaimportowania'}
        </Button>
      </footer>

      {viewer && <ImageViewer src={review.thumb} onClose={() => setViewer(false)} />}

      <PersonPicker
        open={picking !== null}
        written={normalized.persons.find((p) => p.key === picking)?.nameAsWritten ?? ''}
        persons={persons}
        onClose={() => setPicking(null)}
        onPick={(dec) => {
          if (picking) setPerson(picking, dec);
          setPicking(null);
        }}
      />

      {editing && (
        <EntrySheet
          key={editing.entry.id}
          open
          person={normalized.persons.find((p) => p.key === editing.key)!}
          view={viewEntry(
            normalized.persons.find((p) => p.key === editing.key)!,
            editing.entry,
            decisions,
          )}
          defaults={s.settings.defaultHours}
          onChange={(patch) => setEdit(editing.editKey, patch)}
          onClose={() => setEditing(null)}
        />
      )}

      <Alert
        open={confirmDiscard}
        title="Odrzucić wynik skanowania?"
        message="Zdjęcie i wprowadzone poprawki zostaną usunięte."
        onClose={() => {
          setConfirmDiscard(false);
          setGuard((g) => g + 1); // ponownie zarejestruj wpis historii dla ekranu
        }}
        actions={[
          { label: 'Zostań', onSelect: () => {} },
          { label: 'Odrzuć', destructive: true, onSelect: () => void s.discardReview() },
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ osoba */

function PersonSection({
  person,
  decisions,
  label,
  red,
  persons,
  onPick,
  onConfirm,
  onNewName,
  onEntry,
  onChoice,
}: {
  person: NormalizedPerson;
  decisions: ImportDecisions;
  label: { text: string; cls: string | undefined };
  red: boolean;
  persons: Person[];
  onPick: () => void;
  onConfirm: () => void;
  onNewName: (first: string, last?: string) => void;
  onEntry: (e: NormalizedEntry, editKey: string) => void;
  onChoice: (date: string, v: 'first' | 'second') => void;
}) {
  const dec = decisions.persons[person.key];
  const skipped = dec?.mode === 'skip';
  return (
    <GroupedList header={person.nameAsWritten}>
      <button
        type="button"
        className={`${styles.personHead} ${red ? styles.redBorder : ''}`}
        data-testid={`person-${person.key}`}
        aria-label={`${person.nameAsWritten}: ${label.text}. Zmień dopasowanie`}
        onClick={onPick}
      >
        <span className={styles.personName}>{person.nameAsWritten}</span>
        <span className={label.cls}>{label.text}</span>
      </button>
      {dec?.mode === 'existing' && !dec.confirmed && (
        <div className={styles.segWrap}>
          <Button variant="tinted" onClick={onConfirm}>
            <Check size={18} /> Potwierdź:{' '}
            {fullName(persons.find((p) => p.id === dec.personId) ?? { firstName: '?' })}
          </Button>
        </div>
      )}
      {dec?.mode === 'new' && (
        <div className={styles.nameFields}>
          <input
            type="text"
            aria-label={`Imię nowej osoby (${person.nameAsWritten})`}
            value={dec.firstName}
            autoCapitalize="words"
            onChange={(e) => onNewName(e.target.value, dec.lastName)}
          />
          <input
            type="text"
            aria-label={`Nazwisko nowej osoby (${person.nameAsWritten})`}
            placeholder="Nazwisko (opcjonalnie)"
            value={dec.lastName ?? ''}
            autoCapitalize="words"
            onChange={(e) => onNewName(dec.firstName, e.target.value)}
          />
        </div>
      )}
      {!skipped &&
        person.conflicts.map((c) => (
          <div key={c.date} className={styles.conflictRow} data-testid="entry-conflict">
            <span>
              <strong>{formatDayLong(c.date)}</strong>: sprzeczne wpisy — strona 1:{' '}
              {shiftLabel(c.first)}, strona 2: {shiftLabel(c.second)}
            </span>
            <SegmentedControl<'first' | 'second'>
              label={`Wybór dla ${person.nameAsWritten}, ${c.date}`}
              value={(decisions.entryChoice[`${person.key}|${c.date}`] ?? '') as 'first'}
              onChange={(v) => onChoice(c.date, v)}
              options={[
                { value: 'first', label: 'Strona 1' },
                { value: 'second', label: 'Strona 2' },
              ]}
            />
          </div>
        ))}
      <div
        className={`${styles.days} ${skipped ? styles.dayRemoved : ''}`}
        data-testid={`days-${person.key}`}
      >
        {person.entries.map((e) => {
          const v = viewEntry(person, e, decisions);
          const en = v.entry;
          const text =
            en.kind === 'work' && en.start && en.end
              ? `${compactHour(en.start)}–${compactHour(en.end)}`
              : KIND_SHORT[en.kind === 'work' ? 'other' : en.kind];
          return (
            <button
              key={e.id}
              type="button"
              data-testid="day-cell"
              className={`${styles.day} ${en.kind !== 'work' ? styles.dayOff : ''} ${
                en.lowConfidence ? styles.dayLow : ''
              } ${en.suspicious ? styles.daySusp : ''} ${v.removed ? styles.dayRemoved : ''}`}
              aria-label={`${formatDayLong(en.date)}: ${v.removed ? 'usunięty' : shiftLabel(en)}${
                en.lowConfidence ? ', niska pewność odczytu' : ''
              }`}
              onClick={() => onEntry(e, v.editKey)}
            >
              <b>{Number(en.date.slice(8))}</b>
              <span>{text}</span>
            </button>
          );
        })}
        {person.entries.length === 0 && <span>Brak wykrytych dni.</span>}
      </div>
    </GroupedList>
  );
}

/* --------------------------------------------------------- wybór osoby */

function PersonPicker({
  open,
  written,
  persons,
  onPick,
  onClose,
}: {
  open: boolean;
  written: string;
  persons: Person[];
  onPick: (d: NonNullable<ImportDecisions['persons'][string]>) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={`Kto to: „${written}”?`} detent="large">
      <GroupedList header="Istniejące osoby">
        {persons
          .filter((p) => !p.archived)
          .map((p, i, arr) => (
            <ListRow
              key={p.id}
              title={fullName(p)}
              subtitle={p.aliases.length ? `aliasy: ${p.aliases.join(', ')}` : undefined}
              onClick={() => onPick({ mode: 'existing', personId: p.id, confirmed: true })}
              last={i === arr.length - 1}
            />
          ))}
        {persons.filter((p) => !p.archived).length === 0 && (
          <ListRow title="Brak osób w bazie" last />
        )}
      </GroupedList>
      <GroupedList>
        <ListRow
          title="Nowa osoba"
          subtitle="Utworzymy ją przy imporcie"
          onClick={() =>
            onPick({ mode: 'new', firstName: written.replace(/\.$/, ''), lastName: undefined })
          }
        />
        <ListRow title="Pomiń tę osobę" onClick={() => onPick({ mode: 'skip' })} last />
      </GroupedList>
    </Sheet>
  );
}

/* ------------------------------------------------------- edycja wpisu */

function EntrySheet({
  open,
  person,
  view,
  defaults,
  onChange,
  onClose,
}: {
  open: boolean;
  person: NormalizedPerson;
  view: { entry: NormalizedEntry; removed: boolean };
  defaults: Parameters<typeof defaultHoursFor>[1];
  onChange: (p: EntryEdit) => void;
  onClose: () => void;
}) {
  const e = view.entry;
  const dflt = defaultHoursFor(e.date, defaults);
  return (
    <Sheet open={open} onClose={onClose} title="Popraw wpis" detent="medium">
      <GroupedList>
        <ListRow title="Osoba" value={person.nameAsWritten} />
        <ListRow title="Dzień" value={formatDayLong(e.date)} />
        <ListRow title="Odczytano" value={e.rawCell || '—'} last />
      </GroupedList>
      {e.notes.length > 0 && (
        <GroupedList header="Uwagi">
          <ul className={styles.warnList}>
            {e.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </GroupedList>
      )}
      <GroupedList header="Typ">
        <div className={styles.segWrap}>
          <SegmentedControl<ShiftKind>
            label="Typ wpisu"
            value={e.kind}
            onChange={(k) =>
              onChange({
                kind: k,
                ...(k === 'work' ? { start: e.start ?? dflt.start, end: e.end ?? dflt.end } : {}),
              })
            }
            options={KIND_OPTIONS}
          />
        </div>
      </GroupedList>
      {e.kind === 'work' && (
        <GroupedList header="Godziny">
          <ListRow
            title="Domyślne wg dnia"
            subtitle={`${dflt.start}–${dflt.end}`}
            trailing={
              <Toggle
                label="Domyślne wg dnia"
                checked={e.usesDefaultHours}
                onChange={(v) =>
                  onChange(
                    v
                      ? { usesDefaultHours: true, start: dflt.start, end: dflt.end }
                      : { usesDefaultHours: false },
                  )
                }
              />
            }
            last={e.usesDefaultHours}
          />
          {!e.usesDefaultHours && (
            <ListRow
              title="Od – do"
              trailing={
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TimeField
                    label="Początek zmiany"
                    value={e.start ?? dflt.start}
                    onChange={(v) => onChange({ start: v, usesDefaultHours: false })}
                  />
                  –
                  <TimeField
                    label="Koniec zmiany"
                    value={e.end ?? dflt.end}
                    onChange={(v) => onChange({ end: v, usesDefaultHours: false })}
                  />
                </span>
              }
              last
            />
          )}
        </GroupedList>
      )}
      <div
        style={{
          display: 'grid',
          gap: 8,
          padding: '0 calc(var(--sar) + 1rem) 1rem calc(var(--sal) + 1rem)',
        }}
      >
        <Button onClick={onClose}>Gotowe</Button>
        <Button
          variant="tinted"
          destructive={!view.removed}
          onClick={() => {
            onChange({ removed: !view.removed });
            onClose();
          }}
        >
          {view.removed ? 'Przywróć wpis' : 'Usuń wpis'}
        </Button>
      </div>
    </Sheet>
  );
}
