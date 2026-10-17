import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeName } from '../ai/names';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Paleta poleceń (Ctrl+K): szybkie przejścia, akcje i osoby; wyszukiwanie bez polskich znaków. */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const items = useMemo(() => {
    const needle = normalizeName(q);
    if (!needle) return commands.slice(0, 40);
    return commands.filter((c) => normalizeName(c.label).includes(needle)).slice(0, 40);
  }, [commands, q]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <dialog
      ref={dlg}
      className="modal palette"
      aria-label="Paleta poleceń"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === dlg.current) onClose();
      }}
    >
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-label="Szukaj polecenia"
        placeholder="Wpisz polecenie lub imię osoby…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIdx((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            run(items[idx]);
          }
        }}
      />
      <ul id="palette-list" role="listbox" aria-label="Polecenia">
        {items.length === 0 && (
          <li className="muted" style={{ padding: 12 }}>
            Brak wyników
          </li>
        )}
        {items.map((c, i) => (
          <li key={c.id} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={i === idx}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(c)}
            >
              <span className="grow">{c.label}</span>
              {c.hint && <span className="kbd">{c.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
