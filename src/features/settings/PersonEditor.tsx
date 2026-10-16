import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Plus, X } from 'lucide-react';
import { Alert, Button, GroupedList, ListRow, Sheet, TextRow, Toggle, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { colorVar, fullName, PERSON_COLORS } from '../../domain/people';
import { plural, SHIFTS } from '../../domain/i18n';
import type { Person } from '../../domain/types';
import styles from './Settings.module.css';

export const COLOR_NAMES: Record<string, string> = {
  blue: 'niebieski',
  green: 'zielony',
  orange: 'pomarańczowy',
  pink: 'różowy',
  purple: 'fioletowy',
  teal: 'morski',
  indigo: 'indygo',
  red: 'czerwony',
  yellow: 'żółty',
  mint: 'miętowy',
  cyan: 'błękitny',
  brown: 'brązowy',
};

interface Draft {
  firstName: string;
  lastName: string;
  color: string;
  aliases: string[];
  isMe: boolean;
  archived: boolean;
}

const toDraft = (p: Person): Draft => ({
  firstName: p.firstName,
  lastName: p.lastName ?? '',
  color: p.color,
  aliases: p.aliases,
  isMe: p.isMe,
  archived: p.archived,
});

/** Sheet edycji osoby. `person === null` → tworzenie nowej (kolor podpowiedziany przez rodzica). */
export function PersonEditor({
  open,
  person,
  suggestedColor,
  onClose,
}: {
  open: boolean;
  person: Person | null;
  suggestedColor: string;
  onClose: () => void;
}) {
  // Komponent jest montowany od nowa przy każdym otwarciu (key u rodzica) — draft startuje z person.
  const [draft, setDraft] = useState<Draft>(() =>
    person
      ? toDraft(person)
      : {
          firstName: '',
          lastName: '',
          color: suggestedColor,
          aliases: [],
          isMe: false,
          archived: false,
        },
  );
  const [aliasInput, setAliasInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveLock = useRef(false);
  const toast = useToast();

  const shiftCount =
    useLiveQuery(
      () => (person ? repos.shifts.forPerson(person.id).then((s) => s.length) : 0),
      [person?.id],
    ) ?? 0;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const addAlias = () => {
    const a = aliasInput.trim();
    if (a && !draft.aliases.includes(a)) set('aliases', [...draft.aliases, a]);
    setAliasInput('');
  };

  const canSave = draft.firstName.trim().length > 0 && !saving;

  const save = async () => {
    if (saveLock.current || !canSave) return; // brak podwójnego zapisu
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      const alias = aliasInput.trim();
      const aliases =
        alias && !draft.aliases.includes(alias) ? [...draft.aliases, alias] : draft.aliases;
      const data = {
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim() || undefined,
        color: draft.color,
        aliases,
        isMe: draft.isMe,
        archived: draft.archived,
      };
      if (person) await repos.persons.update(person.id, data);
      else await repos.persons.create(data);
      onClose();
    } catch {
      setError('Nie udało się zapisać osoby. Spróbuj ponownie.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!person) return;
    try {
      const token = await repos.persons.remove(person.id);
      const name = fullName(person);
      onClose();
      toast(`Usunięto: ${name}`, () => {
        repos.persons
          .restore(person.id, token)
          .catch(() => toast('Nie udało się cofnąć usunięcia.'));
      });
    } catch {
      setError('Nie udało się usunąć osoby.');
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={person ? 'Edytuj osobę' : 'Nowa osoba'}
        detent="large"
      >
        <GroupedList>
          <TextRow
            label="Imię"
            value={draft.firstName}
            onChange={(v) => set('firstName', v)}
            placeholder="Wymagane"
          />
          <TextRow
            label="Nazwisko"
            value={draft.lastName}
            onChange={(v) => set('lastName', v)}
            placeholder="Opcjonalnie"
          />
        </GroupedList>

        <GroupedList header="Kolor">
          <div className={styles.colors} role="radiogroup" aria-label="Kolor osoby">
            {PERSON_COLORS.map((c) => {
              const on = draft.color === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={COLOR_NAMES[c]}
                  className={styles.colorBtn}
                  onClick={() => set('color', c)}
                >
                  <span
                    className={`${styles.swatch} ${on ? styles.swatchOn : ''}`}
                    style={{ background: colorVar(c) }}
                  >
                    {on && <Check size={16} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </GroupedList>

        <GroupedList
          header="Aliasy"
          footer="Warianty zapisu z grafiku, np. „Kasia”, „K. Nowak” — używane przy skanowaniu."
        >
          {draft.aliases.length > 0 && (
            <div className={styles.chips}>
              {draft.aliases.map((a) => (
                <span key={a} className={styles.chip}>
                  {a}
                  <button
                    type="button"
                    aria-label={`Usuń alias ${a}`}
                    onClick={() =>
                      set(
                        'aliases',
                        draft.aliases.filter((x) => x !== a),
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <TextRow
            label="Nowy alias"
            value={aliasInput}
            onChange={setAliasInput}
            onEnter={addAlias}
            placeholder="Wpisz i potwierdź"
            autoCapitalize="none"
          />
          <ListRow
            title="Dodaj alias"
            leading={<Plus size={20} color="var(--accent)" />}
            onClick={addAlias}
            last
          />
        </GroupedList>

        <GroupedList>
          <ListRow
            title="To ja"
            subtitle="Zasila zakładkę „Mój grafik”"
            trailing={
              <Toggle label="To ja" checked={draft.isMe} onChange={(v) => set('isMe', v)} />
            }
          />
          {person && (
            <ListRow
              title="Zarchiwizowana"
              subtitle="Ukryta w nowych widokach, historia zostaje"
              trailing={
                <Toggle
                  label="Zarchiwizowana"
                  checked={draft.archived}
                  onChange={(v) => set('archived', v)}
                />
              }
              last
            />
          )}
        </GroupedList>

        {error && (
          <p role="alert" className={styles.note} style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}

        <div className={styles.formActions}>
          <Button onClick={() => void save()} disabled={!canSave}>
            Zapisz
          </Button>
          {person && (
            <Button variant="tinted" destructive onClick={() => setConfirmDelete(true)}>
              Usuń osobę
            </Button>
          )}
        </div>
      </Sheet>

      <Alert
        open={confirmDelete}
        title={person ? `Usunąć: ${fullName(person)}?` : 'Usunąć osobę?'}
        message={
          shiftCount > 0
            ? `Zostanie usuniętych ${plural(shiftCount, SHIFTS)}. Możesz to cofnąć tuż po usunięciu.`
            : 'Osoba nie ma żadnych zmian. Możesz to cofnąć tuż po usunięciu.'
        }
        onClose={() => setConfirmDelete(false)}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          { label: 'Usuń', destructive: true, onSelect: () => void remove() },
        ]}
      />
    </>
  );
}
