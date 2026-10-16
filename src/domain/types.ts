/** Typy domenowe (czyste, bez zależności od bazy). Schemat: sekcja 5 planu. */

export type ISODate = string; // 'YYYY-MM-DD', czas lokalny
export type HHMM = string; // 'HH:MM'
export type ShiftKind = 'work' | 'off' | 'vacation' | 'sick' | 'other';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = niedziela

export interface Person {
  id: string;
  firstName: string;
  lastName?: string;
  color: string;
  aliases: string[];
  isMe: boolean;
  archived: boolean;
  order: number;
  createdAt: number;
  deletedAt?: number;
}

export interface Shift {
  id: string;
  personId: string;
  date: ISODate;
  kind: ShiftKind;
  start?: HHMM;
  end?: HHMM; // end <= start => koniec następnego dnia
  usesDefaultHours: boolean;
  note?: string;
  source: 'manual' | 'ai';
  importBatchId?: string;
  deletedAt?: number;
  updatedAt: number;
}

export interface ImportBatch {
  id: string;
  createdAt: number;
  model: string;
  promptVersion: string;
  imageThumb?: string;
  shiftIds: string[];
  replacedShifts: Shift[];
  revertedAt?: number;
}

export interface ScanDraft {
  id: 'current';
  createdAt: number;
  parsed: unknown;
  decisions: unknown;
  imageThumb: string;
}

export type DefaultHours = Record<Weekday, { start: HHMM; end: HHMM }>;

export interface Settings {
  id: 'app';
  defaultHours: DefaultHours;
  weekStartsOn: 0 | 1;
  geminiApiKey?: string;
  geminiModel: string;
  aiPrivacyAcknowledged: boolean;
  theme: 'system' | 'light' | 'dark';
}
