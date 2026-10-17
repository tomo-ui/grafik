import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { normalizeName } from '../../ai/names';
import { usePersons } from '../../app/data';
import { repos } from '../../db/repos';
import { monthDays, todayISO } from '../../domain/dates';
import { formatHours, PEOPLE, plural } from '../../domain/i18n';
import { colorVar, fullName, nextColor, PERSON_COLORS } from '../../domain/people';
import { totalsByPerson } from '../../domain/totals';
import type { Person } from '../../domain/types';
import { usePc } from '../store';
import { Empty, Modal, useConfirm, useToast } from '../ui';

interface Draft {
  id?: string;
  firstName: string;
  lastName: string;
  color: string;
  aliases: string[];
  isMe: boolean;
  archived: boolean;
}

const blank = (used: string[]): Draft => ({
  firstName: '',
  lastName: '',
  color: nextColor(used),
  aliases: [],
  isMe: false,
  archived: false,
});

export function PeoplePage() {
  const persons = usePersons(true);
  const toast = useToast();
  const confirm = useConfirm();
  const { intent, setIntent, peopleQuery, setPeopleQuery } = usePc();
  const [query, setQuery] = useState(peopleQuery);
  const [showArchived, setShowArchived] = useState(false);
  const [draftState, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const today = todayISO();
  const days = monthDays(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const month = useLiveQuery(() => repos.shifts.range(from, to), [from, to]);
  const monthTotals = useMemo(() => totalsByPerson(month ?? [], from, to), [month, from, to]);
  const monthCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of month ?? []) m.set(s.personId, (m.get(s.personId) ?? 0) + 1);
    return m;
  }, [month]);

  // intencja z palety poleceń („Dodaj osobę”) i wyszukiwanie przekazane z innej strony
  useEffect(() => {
    if (peopleQuery) setPeopleQuery('');
  }, [peopleQuery, setPeopleQuery]);

  const all = useMemo(() => persons ?? [], [persons]);
  // „Dodaj osobę” z palety poleceń otwiera okno bez efektu (intencja z magazynu UI)
  const draft =
    draftState ?? (intent === 'add-person' && persons ? blank(all.map((p) => p.color)) : null);
  const closeDraft = () => {
    setDraft(null);
    setIntent(null);
  };
  const visible = useMemo(() => {
    const needle = normalizeName(query);
    return all.filter(
      (p) =>
        (showArchived || !p.archived) &&
        (!needle || normalizeName(`${fullName(p)} ${p.aliases.join(' ')}`).includes(needle)),
    );
  }, [all, query, showArchived]);
  const filtering = !!query.trim() || showArchived;

  const move = async (p: Person, dir: -1 | 1) => {
    const i = all.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= all.length) return;
    const ids = all.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    try {
      await repos.persons.reorder(ids);
    } catch {
      toast('Nie udało się zmienić kolejności.');
    }
  };

  const save = async () => {
    if (!draft || busy) return;
    const firstName = draft.firstName.trim();
    if (!firstName) return;
    setBusy(true);
    try {
      const data = {
        firstName,
        lastName: draft.lastName.trim() || undefined,
        color: draft.color,
        aliases: [...new Set(draft.aliases.map((a) => a.trim()).filter(Boolean))],
        isMe: draft.isMe,
        archived: draft.archived,
      };
      if (draft.id) await repos.persons.update(draft.id, data);
      else await repos.persons.create(data);
      toast(draft.id ? 'Zapisano zmiany osoby.' : `Dodano: ${firstName}`);
      closeDraft();
    } catch {
      toast('Nie udało się zapisać osoby.');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (ids: string[], archived: boolean) => {
    try {
      await Promise.all(ids.map((id) => repos.persons.update(id, { archived })));
      setSelected(new Set());
      toast(archived ? `Zarchiwizowano: ${plural(ids.length, PEOPLE)}` : 'Przywrócono z archiwum.');
    } catch {
      toast('Nie udało się zmienić statusu.');
    }
  };

  const remove = async (ids: string[]) => {
    const names = all.filter((p) => ids.includes(p.id)).map((p) => fullName(p));
    const ok = await confirm({
      title:
        ids.length === 1 ? `Usunąć osobę ${names[0]}?` : `Usunąć ${plural(ids.length, PEOPLE)}?`,
      message:
        'Zmiany tych osób też zostaną usunięte. Przez 30 dni można je przywrócić z Kosza (Dane i kopie).',
      confirmLabel: 'Usuń',
      danger: true,
    });
    if (!ok) return;
    try {
      const tokens: { id: string; token: Awaited<ReturnType<typeof repos.persons.remove>> }[] = [];
      for (const id of ids) tokens.push({ id, token: await repos.persons.remove(id) });
      setSelected(new Set());
      toast(`Usunięto: ${plural(ids.length, PEOPLE)}`, {
        label: 'Cofnij',
        run: () => {
          void Promise.all(tokens.map((t) => repos.persons.restore(t.id, t.token))).then(() =>
            toast('Przywrócono.'),
          );
        },
      });
    } catch {
      toast('Nie udało się usunąć.');
    }
  };

  const allChecked = visible.length > 0 && visible.every((p) => selected.has(p.id));

  return (
    <>
      <div className="pc-head">
        <h1>Osoby</h1>
        <input
          className="input"
          type="search"
          placeholder="Szukaj (imię, nazwisko, alias)…"
          aria-label="Szukaj osoby"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 280 }}
        />
        <label className="row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Pokaż zarchiwizowane
        </label>
        <button
          type="button"
          className="btn primary"
          onClick={() => setDraft(blank(all.map((p) => p.color)))}
        >
          <Plus size={16} aria-hidden /> Dodaj osobę
        </button>
      </div>
      <div className="pc-page">
        {selected.size > 0 && (
          <div
            className="alert row"
            role="region"
            aria-label="Akcje grupowe"
            style={{ marginBottom: 12 }}
          >
            <b>Zaznaczono: {selected.size}</b>
            <button
              type="button"
              className="btn sm"
              onClick={() => void archive([...selected], true)}
            >
              Archiwizuj
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => void archive([...selected], false)}
            >
              Przywróć
            </button>
            <button
              type="button"
              className="btn sm danger"
              onClick={() => void remove([...selected])}
            >
              Usuń
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setSelected(new Set())}>
              Odznacz
            </button>
          </div>
        )}
        {persons && all.length === 0 ? (
          <Empty title="Nie ma jeszcze żadnych osób">
            <p>Dodaj pierwszą osobę, aby zacząć układać grafik.</p>
            <button type="button" className="btn primary" onClick={() => setDraft(blank([]))}>
              Dodaj osobę
            </button>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Lista osób">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      aria-label="Zaznacz wszystkie"
                      checked={allChecked}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? new Set(visible.map((p) => p.id)) : new Set(),
                        )
                      }
                    />
                  </th>
                  <th>Osoba</th>
                  <th>Aliasy (jak pojawia się w grafikach)</th>
                  <th className="num">Zmiany (ten miesiąc)</th>
                  <th className="num">Godziny</th>
                  <th>Status</th>
                  <th style={{ width: 300 }}>Akcje</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Zaznacz: ${fullName(p)}`}
                        checked={selected.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>
                      <span
                        className="dot"
                        style={{ background: colorVar(p.color), marginRight: 8 }}
                        aria-hidden
                      />
                      <b>{fullName(p)}</b>
                    </td>
                    <td>
                      <div className="chips">
                        {p.aliases.length === 0 && <span className="muted">—</span>}
                        {p.aliases.map((a) => (
                          <span key={a} className="chip" style={{ paddingRight: 9 }}>
                            {a}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num">{monthCounts.get(p.id) ?? 0}</td>
                    <td className="num">
                      {monthTotals.get(p.id) ? formatHours(monthTotals.get(p.id)!) : '—'}
                    </td>
                    <td>
                      {p.isMe && <span className="badge ok">To ja</span>}{' '}
                      {p.archived && <span className="badge warn">Archiwum</span>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className="btn icon sm"
                          aria-label={`Przesuń w górę: ${fullName(p)}`}
                          disabled={filtering || all[0]?.id === p.id}
                          onClick={() => void move(p, -1)}
                        >
                          <ArrowUp size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn icon sm"
                          aria-label={`Przesuń w dół: ${fullName(p)}`}
                          disabled={filtering || all[all.length - 1]?.id === p.id}
                          onClick={() => void move(p, 1)}
                        >
                          <ArrowDown size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            setDraft({
                              id: p.id,
                              firstName: p.firstName,
                              lastName: p.lastName ?? '',
                              color: p.color,
                              aliases: p.aliases,
                              isMe: p.isMe,
                              archived: p.archived,
                            })
                          }
                        >
                          Edytuj
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => void archive([p.id], !p.archived)}
                        >
                          {p.archived ? 'Przywróć' : 'Archiwizuj'}
                        </button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => void remove([p.id])}
                        >
                          Usuń
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {persons && visible.length === 0 && all.length > 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                      Nikogo nie znaleziono.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Aliasy to zapisy imienia spotykane w papierowych grafikach (np. „Kasia”, „K. Nowak”) —
          import ze zdjęcia dopasuje je automatycznie.
        </p>
      </div>

      {draft && (
        <PersonModal
          draft={draft}
          onChange={setDraft}
          onClose={closeDraft}
          onSave={() => void save()}
          busy={busy}
        />
      )}
    </>
  );
}

function PersonModal({
  draft,
  onChange,
  onClose,
  onSave,
  busy,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [alias, setAlias] = useState('');
  const addAlias = () => {
    const a = alias.trim();
    if (a && !draft.aliases.includes(a)) onChange({ ...draft, aliases: [...draft.aliases, a] });
    setAlias('');
  };
  return (
    <Modal
      title={draft.id ? 'Edytuj osobę' : 'Nowa osoba'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!draft.firstName.trim() || busy}
            onClick={onSave}
          >
            Zapisz
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        style={{ display: 'contents' }}
      >
        <div className="two">
          <label className="field">
            <span>Imię *</span>
            <input
              className="input"
              autoFocus
              value={draft.firstName}
              onChange={(e) => onChange({ ...draft, firstName: e.target.value })}
              aria-label="Imię"
            />
          </label>
          <label className="field">
            <span>Nazwisko</span>
            <input
              className="input"
              value={draft.lastName}
              onChange={(e) => onChange({ ...draft, lastName: e.target.value })}
              aria-label="Nazwisko"
            />
          </label>
        </div>
        <div className="field">
          <span>Kolor w siatce</span>
          <div className="row" role="radiogroup" aria-label="Kolor">
            {PERSON_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={draft.color === c}
                aria-label={c}
                onClick={() => onChange({ ...draft, color: c })}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: colorVar(c),
                  border: draft.color === c ? '3px solid var(--text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <span>Aliasy</span>
          <div className="chips">
            {draft.aliases.map((a) => (
              <span key={a} className="chip">
                {a}
                <button
                  type="button"
                  aria-label={`Usuń alias ${a}`}
                  onClick={() =>
                    onChange({ ...draft, aliases: draft.aliases.filter((x) => x !== a) })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="row">
            <input
              className="input grow"
              value={alias}
              placeholder="Dodaj alias i naciśnij Enter"
              aria-label="Nowy alias"
              onChange={(e) => setAlias(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addAlias();
                }
              }}
            />
            <button type="button" className="btn" onClick={addAlias}>
              Dodaj
            </button>
          </div>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={draft.isMe}
            onChange={(e) => onChange({ ...draft, isMe: e.target.checked })}
          />
          To ja (tylko jedna osoba może mieć ten znacznik)
        </label>
        {draft.id && (
          <label className="row">
            <input
              type="checkbox"
              checked={draft.archived}
              onChange={(e) => onChange({ ...draft, archived: e.target.checked })}
            />
            Zarchiwizowana (ukryta w siatce, bez usuwania danych)
          </label>
        )}
      </form>
    </Modal>
  );
}
