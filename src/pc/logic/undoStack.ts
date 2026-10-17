/** Stos cofnij/ponów dla operacji na grafiku (w pamięci karty; trwałe cofanie to Kosz). */
export interface Operation {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export class UndoStack {
  private done: Operation[] = [];
  private undone: Operation[] = [];
  private listeners = new Set<() => void>();
  private busy = false;

  constructor(private limit = 100) {}

  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }
  get undoLabel() {
    return this.done[this.done.length - 1]?.label;
  }
  get redoLabel() {
    return this.undone[this.undone.length - 1]?.label;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Zapisuje wykonaną już operację; nowa operacja kasuje „ponów”. */
  push(op: Operation) {
    this.done.push(op);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    this.emit();
  }

  /** Cofa ostatnią operację; zwraca jej etykietę (lub null). Błąd zostawia stos bez zmian. */
  async undo(): Promise<string | null> {
    if (this.busy) return null;
    const op = this.done[this.done.length - 1];
    if (!op) return null;
    this.busy = true;
    try {
      await op.undo();
      this.done.pop();
      this.undone.push(op);
      this.emit();
      return op.label;
    } finally {
      this.busy = false;
    }
  }

  async redo(): Promise<string | null> {
    if (this.busy) return null;
    const op = this.undone[this.undone.length - 1];
    if (!op) return null;
    this.busy = true;
    try {
      await op.redo();
      this.undone.pop();
      this.done.push(op);
      this.emit();
      return op.label;
    } finally {
      this.busy = false;
    }
  }

  clear() {
    this.done = [];
    this.undone = [];
    this.emit();
  }
}
