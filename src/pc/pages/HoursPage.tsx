import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Printer } from 'lucide-react';
import { usePersons } from '../../app/data';
import { repos } from '../../db/repos';
import { isValidISODate, monthDays, todayISO, weekdayOf } from '../../domain/dates';
import { DAY_SHORT, formatDayLong, formatHours } from '../../domain/i18n';
import { shiftLabel } from '../../domain/labels';
import { shiftWorkMinutes } from '../../domain/totals';
import type { ISODate } from '../../domain/types';
import { buildReport, hoursText, reportToCsv } from '../logic/report';
import { downloadBlob, Empty, Modal, Seg } from '../ui';

type Preset = 'month' | 'year' | 'custom';

const monthName = (m: number) =>
  new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date(2026, m - 1, 1));

export function HoursPage() {
  const persons = usePersons(true);
  const today = todayISO();
  const [preset, setPreset] = useState<Preset>('month');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [custom, setCustom] = useState<{ from: ISODate; to: ISODate }>(() => {
    const d = monthDays(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
    return { from: d[0]!, to: d[d.length - 1]! };
  });
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
    if (preset === 'month') {
      const d = monthDays(year, month);
      return { from: d[0]!, to: d[d.length - 1]! };
    }
    return custom;
  }, [preset, year, month, custom]);
  const rangeValid =
    isValidISODate(range.from) && isValidISODate(range.to) && range.from <= range.to;

  const shifts = useLiveQuery(
    () => (rangeValid ? repos.shifts.range(range.from, range.to) : Promise.resolve([])),
    [range.from, range.to, rangeValid],
  );
  const report = useMemo(
    () =>
      persons && shifts && rangeValid
        ? buildReport(persons, shifts, range.from, range.to, { includeEmpty })
        : null,
    [persons, shifts, range, rangeValid, includeEmpty],
  );

  const detailPerson = persons?.find((p) => p.id === detail);
  const detailShifts = useMemo(
    () =>
      (shifts ?? [])
        .filter((s) => s.personId === detail)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [shifts, detail],
  );

  const exportCsv = () => {
    if (!report) return;
    downloadBlob(
      new Blob(['﻿', reportToCsv(report)], { type: 'text/csv;charset=utf-8' }),
      `Godziny_${range.from}_${range.to}.csv`,
    );
  };

  const years = Array.from({ length: 11 }, (_, i) => Number(today.slice(0, 4)) - 8 + i);

  return (
    <>
      <div className="pc-head">
        <h1>Godziny i raporty</h1>
        <Seg
          label="Okres raportu"
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'month', label: 'Miesiąc' },
            { value: 'year', label: 'Rok' },
            { value: 'custom', label: 'Własny zakres' },
          ]}
        />
        {preset !== 'custom' && (
          <>
            {preset === 'month' && (
              <select
                className="select"
                aria-label="Miesiąc"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            )}
            <select
              className="select"
              aria-label="Rok"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </>
        )}
        {preset === 'custom' && (
          <>
            <label className="row">
              Od
              <input
                className={`input${isValidISODate(custom.from) ? '' : ' invalid'}`}
                type="date"
                aria-label="Od dnia"
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
              />
            </label>
            <label className="row">
              Do
              <input
                className={`input${isValidISODate(custom.to) ? '' : ' invalid'}`}
                type="date"
                aria-label="Do dnia"
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
              />
            </label>
          </>
        )}
        <label className="row">
          <input
            type="checkbox"
            checked={includeEmpty}
            onChange={(e) => setIncludeEmpty(e.target.checked)}
          />
          Pokaż osoby bez zmian
        </label>
        <button type="button" className="btn" disabled={!report} onClick={exportCsv}>
          <Download size={15} aria-hidden /> Eksport CSV
        </button>
        <button
          type="button"
          className="btn icon"
          aria-label="Drukuj raport"
          onClick={() => window.print()}
        >
          <Printer size={16} aria-hidden />
        </button>
      </div>

      <div className="pc-page">
        {!rangeValid && (
          <div className="alert danger" role="alert">
            Podaj poprawny zakres dat (od ≤ do).
          </div>
        )}
        {report && report.rows.length === 0 && (
          <Empty title="Brak osób w raporcie">
            <p>Dodaj osoby w zakładce „Osoby”.</p>
          </Empty>
        )}
        {report && report.rows.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table" aria-label="Raport godzin">
                <thead>
                  <tr>
                    <th>Osoba</th>
                    <th className="num">Dni pracy</th>
                    <th className="num">Godziny</th>
                    <th className="num">Pt / Sb</th>
                    <th className="num">Wolne</th>
                    <th className="num">Urlop</th>
                    <th className="num">L4</th>
                    <th className="num">Inne</th>
                    <th className="no-print" />
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.personId}>
                      <td>
                        <b>{r.name}</b>
                      </td>
                      <td className="num">{r.workDays}</td>
                      <td className="num">{hoursText(r.minutes)}</td>
                      <td className="num">{r.fridaySaturdayDays}</td>
                      <td className="num">{r.off}</td>
                      <td className="num">{r.vacation}</td>
                      <td className="num">{r.sick}</td>
                      <td className="num">{r.other}</td>
                      <td className="no-print">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setDetail(r.personId)}
                        >
                          Szczegóły
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Razem</td>
                    <td className="num">{report.totals.workDays}</td>
                    <td className="num">{hoursText(report.totals.minutes)}</td>
                    <td className="num">{report.totals.fridaySaturdayDays}</td>
                    <td className="num">{report.totals.off}</td>
                    <td className="num">{report.totals.vacation}</td>
                    <td className="num">{report.totals.sick}</td>
                    <td className="num">{report.totals.other}</td>
                    <td className="no-print" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {report.staffing.length <= 62 && (
              <section className="card" aria-label="Obsada dzienna" style={{ marginTop: 16 }}>
                <h2>Obsada dzienna (osób w pracy)</h2>
                <div
                  className="bars"
                  role="img"
                  aria-label={`Obsada dzienna, maksymalnie ${report.maxStaffing} osób`}
                >
                  {report.staffing.map((d) => {
                    const wd = weekdayOf(d.date);
                    return (
                      <div
                        key={d.date}
                        className={wd === 0 || wd === 6 ? 'weekend' : ''}
                        title={`${formatDayLong(d.date)}: ${d.count}`}
                        style={{
                          height: `${report.maxStaffing ? (d.count / report.maxStaffing) * 100 : 0}%`,
                        }}
                      />
                    );
                  })}
                </div>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  Najniższa obsada: <b>{Math.min(...report.staffing.map((d) => d.count))}</b>,
                  najwyższa: <b>{report.maxStaffing}</b>. Weekendy zaznaczone kolorem pomarańczowym.
                </p>
              </section>
            )}
          </>
        )}
      </div>

      {detailPerson && (
        <Modal
          wide
          title={`Szczegóły: ${detailPerson.firstName} ${detailPerson.lastName ?? ''}`}
          onClose={() => setDetail(null)}
          footer={
            <button type="button" className="btn" onClick={() => setDetail(null)}>
              Zamknij
            </button>
          }
        >
          {detailShifts.length === 0 ? (
            <p className="muted">Brak zmian w tym okresie.</p>
          ) : (
            <table className="table" aria-label="Zmiany osoby">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Dzień</th>
                  <th>Zmiana</th>
                  <th className="num">Godziny</th>
                  <th>Notatka</th>
                </tr>
              </thead>
              <tbody>
                {detailShifts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{DAY_SHORT[weekdayOf(s.date)]}</td>
                    <td>{shiftLabel(s)}</td>
                    <td className="num">
                      {shiftWorkMinutes(s) ? formatHours(shiftWorkMinutes(s)) : '—'}
                    </td>
                    <td>{s.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </>
  );
}
