import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePersons } from '../../app/data';
import type { Settings, Shift } from '../../domain/types';
import { AddShiftSheet, type AddPrefill } from './AddShiftSheet';
import { EditShiftSheet } from './EditShiftSheet';

interface Api {
  openAdd: (prefill?: AddPrefill) => void;
  openEdit: (shift: Shift) => void;
}
const Ctx = createContext<Api>({ openAdd: () => {}, openEdit: () => {} });
export const useShiftEditor = () => useContext(Ctx);

/** Trzyma sheety dodawania/edycji; ekrany tylko wołają openAdd / openEdit. */
export function ShiftEditorProvider({
  settings,
  children,
}: {
  settings: Settings;
  children: ReactNode;
}) {
  const persons = usePersons(true);
  const [add, setAdd] = useState<{ key: number; open: boolean; prefill?: AddPrefill }>({
    key: 0,
    open: false,
  });
  const [edit, setEdit] = useState<{ key: number; open: boolean; shift: Shift | null }>({
    key: 0,
    open: false,
    shift: null,
  });

  const openAdd = useCallback(
    (prefill?: AddPrefill) => setAdd((s) => ({ key: s.key + 1, open: true, prefill })),
    [],
  );
  const openEdit = useCallback(
    (shift: Shift) => setEdit((s) => ({ key: s.key + 1, open: true, shift })),
    [],
  );
  const api = useMemo(() => ({ openAdd, openEdit }), [openAdd, openEdit]);

  const active = (persons ?? []).filter((p) => !p.archived);

  return (
    <Ctx.Provider value={api}>
      {children}
      {persons && (
        <AddShiftSheet
          key={`add${add.key}`}
          open={add.open}
          persons={active}
          settings={settings}
          prefill={add.prefill}
          onClose={() => setAdd((s) => ({ ...s, open: false }))}
        />
      )}
      {edit.shift && (
        <EditShiftSheet
          key={`edit${edit.key}`}
          open={edit.open}
          shift={edit.shift}
          person={persons?.find((p) => p.id === edit.shift?.personId)}
          settings={settings}
          onClose={() => setEdit((s) => ({ ...s, open: false }))}
        />
      )}
    </Ctx.Provider>
  );
}
