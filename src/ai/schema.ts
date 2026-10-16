import { z } from 'zod';
import { AiError } from './errors';

/**
 * responseSchema wysyłany do Gemini (plan 4.4). Rozszerzenie względem planu: opcjonalne pole
 * `weekday` przy wpisie — nagłówek dnia tygodnia z grafiku (Pn…Nd), potrzebny do korekty
 * pomylonego roku/miesiąca (plan 4.6, punkt 2).
 */
const kindEnum = ['work', 'off', 'vacation', 'sick', 'other'];

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    period: {
      type: 'object',
      properties: {
        month: { type: 'integer', nullable: true },
        year: { type: 'integer', nullable: true },
        startDate: { type: 'string', nullable: true, description: 'YYYY-MM-DD' },
        endDate: { type: 'string', nullable: true, description: 'YYYY-MM-DD' },
      },
    },
    legend: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          meaning: { type: 'string', enum: kindEnum },
          start: { type: 'string', nullable: true, description: 'HH:MM' },
          end: { type: 'string', nullable: true, description: 'HH:MM' },
        },
        required: ['symbol', 'meaning'],
      },
    },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nameAsWritten: { type: 'string' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
                weekday: {
                  type: 'string',
                  nullable: true,
                  description: 'weekday header as written: Pn, Wt, Śr, Cz, Pt, Sb, Nd',
                },
                rawCell: { type: 'string' },
                kind: { type: 'string', enum: kindEnum },
                start: { type: 'string', nullable: true },
                end: { type: 'string', nullable: true },
                confidence: { type: 'number' },
              },
              required: ['date', 'rawCell', 'kind', 'confidence'],
            },
          },
        },
        required: ['nameAsWritten', 'entries'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['people'],
} as const;

const kind = z.enum(['work', 'off', 'vacation', 'sick', 'other']);
const nullableStr = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined);

const entrySchema = z.object({
  date: z.string(),
  weekday: nullableStr,
  rawCell: z.string().default(''),
  kind,
  start: nullableStr,
  end: nullableStr,
  confidence: z.number().min(0).max(1).catch(0.5),
});

export const parsedScheduleSchema = z.object({
  period: z
    .object({
      month: z
        .number()
        .int()
        .nullish()
        .transform((v) => v ?? undefined),
      year: z
        .number()
        .int()
        .nullish()
        .transform((v) => v ?? undefined),
      startDate: nullableStr,
      endDate: nullableStr,
    })
    .partial()
    .nullish()
    .transform((v) => v ?? {}),
  legend: z
    .array(
      z.object({
        symbol: z.string(),
        meaning: kind,
        start: nullableStr,
        end: nullableStr,
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
  people: z.array(
    z.object({
      nameAsWritten: z.string(),
      entries: z.array(entrySchema).default([]),
    }),
  ),
  warnings: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});

export type ParsedSchedule = z.infer<typeof parsedScheduleSchema>;
export type ParsedEntry = ParsedSchedule['people'][number]['entries'][number];

/** Zdejmuje ogrodzenie ```json ... ``` i zwraca czysty JSON. */
export function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1]! : t;
}

/** Tekst odpowiedzi modelu → zwalidowany ParsedSchedule (AiError przy złym JSON-ie / schemacie). */
export function parseModelJson(text: string): ParsedSchedule {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(text));
  } catch {
    throw new AiError('bad-json');
  }
  const r = parsedScheduleSchema.safeParse(raw);
  if (!r.success) throw new AiError('bad-schema', { detail: r.error.issues[0]?.message });
  return r.data;
}
