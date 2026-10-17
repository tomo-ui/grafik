import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { uuid } from '../db/db';
import { repos } from '../db/repos';
import type { DefaultHours, Shift } from '../domain/types';
import { plural, SHIFTS } from '../domain/i18n';
import { isEmptyPlan, planCellChanges, type CellTarget, type Plan } from './logic/cellOps';
import { UndoStack } from './logic/undoStack';
import { useToast } from './ui';

/**
 * Operacje na grafiku z cofaniem i ponawianiem (Ctrl+Z / Ctrl+Shift+Z).
 * Wszystko idzie przez repozytoria (soft-delete), więc „Cofnij” przywraca te same rekordy.
 */
interface OpsApi {
  stack: UndoStack;
  /** Zastosuj opisy komórek; zwraca liczbę zmienionych komórek. */
  applyCells: (targets: CellTarget[], defaults: DefaultHours, label: string) => Promise<number>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
}

const Ctx = createContext<OpsApi | null>(null);
export const useOps = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOps poza OpsProvider');
  return v;
};

async function execute(plan: Plan) {
  if (plan.creates.length) await repos.shifts.addMany(plan.creates, 'error');
  for (const u of plan.updates) await repos.shifts.update(u.id, u.after);
  if (plan.deletes.length) await repos.shifts.softDelete(plan.deletes);
}

async function revert(plan: Plan) {
  if (plan.creates.length) await repos.shifts.softDelete(plan.creates.map((s) => s.id));
  for (const u of plan.updates) await repos.shifts.update(u.id, u.before);
  if (plan.deletes.length) await repos.shifts.restore(plan.deletes);
}

async function replay(plan: Plan) {
  if (plan.creates.length) await repos.shifts.restore(plan.creates.map((s) => s.id));
  for (const u of plan.updates) await repos.shifts.update(u.id, u.after);
  if (plan.deletes.length) await repos.shifts.softDelete(plan.deletes);
}

const stack = new UndoStack(200);

export function OpsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const version = useSyncExternalStore(
    (fn) => stack.subscribe(fn),
    () => `${stack.canUndo}|${stack.canRedo}|${stack.undoLabel}|${stack.redoLabel}`,
  );

  const applyCells = useCallback<OpsApi['applyCells']>(async (targets, defaults, label) => {
    if (targets.length === 0) return 0;
    const dates = targets.map((t) => t.date).sort();
    const existing: Shift[] = await repos.shifts.range(dates[0]!, dates[dates.length - 1]!);
    const plan = planCellChanges(targets, existing, defaults, uuid, Date.now());
    if (isEmptyPlan(plan)) return 0;
    await execute(plan);
    const n = plan.creates.length + plan.updates.length + plan.deletes.length;
    stack.push({
      label: `${label} (${plural(n, SHIFTS)})`,
      undo: () => revert(plan),
      redo: () => replay(plan),
    });
    return n;
  }, []);

  const undo = useCallback(async () => {
    try {
      const label = await stack.undo();
      toast(label ? `Cofnięto: ${label}` : 'Nie ma nic do cofnięcia.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Nie udało się cofnąć.');
    }
  }, [toast]);
  const redo = useCallback(async () => {
    try {
      const label = await stack.redo();
      toast(label ? `Ponowiono: ${label}` : 'Nie ma nic do ponowienia.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Nie udało się ponowić.');
    }
  }, [toast]);

  const api = useMemo<OpsApi>(
    () => ({ stack, applyCells, undo, redo, canUndo: stack.canUndo, canRedo: stack.canRedo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` odświeża canUndo/canRedo
    [applyCells, undo, redo, version],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
