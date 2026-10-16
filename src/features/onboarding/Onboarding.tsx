import { useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, Share, SquarePlus } from 'lucide-react';
import { Button, GroupedList, TextRow } from '../../ui';
import { repos } from '../../db/repos';
import { useInstall } from '../../app/install';
import { DEFAULT_HOURS } from '../../domain/hours';
import { HoursEditor, hoursValid } from '../settings/HoursEditor';
import type { DefaultHours } from '../../domain/types';
import styles from './Onboarding.module.css';

/** Onboarding 3 ekrany: powitanie + instalacja → imię (osoba „Ja”) → godziny domyślne. */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [hours, setHours] = useState<DefaultHours>(structuredClone(DEFAULT_HOURS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const install = useInstall();

  const finish = async () => {
    if (lock.current) return; // podwójne tapnięcie „Gotowe” nie utworzy dwóch osób
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const existing = await repos.persons.list({ includeArchived: true });
      if (!existing.some((p) => p.isMe)) {
        await repos.persons.create({
          firstName: name.trim(),
          color: 'blue',
          isMe: true,
          aliases: [],
        });
      }
      await repos.settings.update({ defaultHours: hours, onboardingDone: true });
    } catch {
      setError('Nie udało się zapisać danych. Spróbuj ponownie.');
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        {step > 0 ? (
          <button type="button" className={styles.back} onClick={() => setStep(step - 1)}>
            <ChevronLeft size={22} /> Wstecz
          </button>
        ) : (
          <span />
        )}
        <div className={styles.dots} role="img" aria-label={`Krok ${step + 1} z 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? styles.dotOn : styles.dot} />
          ))}
        </div>
        <span className={styles.topSpacer} />
      </header>

      <div className={styles.body}>
        {step === 0 && (
          <section aria-labelledby="ob1">
            <div className={styles.logo} aria-hidden="true">
              <CalendarDays size={44} strokeWidth={1.75} />
            </div>
            <h1 id="ob1" className={styles.title}>
              Witaj w Grafiku
            </h1>
            <p className={styles.lead}>
              Grafik pracy zespołu w telefonie: dodawaj zmiany ręcznie albo zeskanuj zdjęcie
              grafiku. Działa bez internetu.
            </p>

            {install.standalone ? (
              <p className={styles.ok}>Aplikacja jest zainstalowana.</p>
            ) : install.platform === 'ios' ? (
              <div className={styles.card}>
                <p className={styles.cardTitle}>Zainstaluj przed wprowadzaniem danych</p>
                <ol className={styles.steps}>
                  <li>
                    Stuknij <Share size={16} aria-label="Udostępnij" className={styles.inline} />{' '}
                    <strong>Udostępnij</strong> w Safari.
                  </li>
                  <li>
                    Wybierz <SquarePlus size={16} aria-hidden="true" className={styles.inline} />{' '}
                    <strong>Do ekranu początkowego</strong>.
                  </li>
                  <li>Uruchom Grafik z ikony.</li>
                </ol>
                <p className={styles.warn}>
                  Dane z przeglądarki nie przeniosą się do aplikacji na ekranie początkowym.
                </p>
              </div>
            ) : install.canPrompt ? (
              <div className={styles.card}>
                <p className={styles.cardTitle}>Zainstaluj aplikację</p>
                <Button variant="tinted" onClick={() => void install.install()}>
                  Zainstaluj
                </Button>
              </div>
            ) : install.platform === 'android' ? (
              <div className={styles.card}>
                <p className={styles.cardTitle}>Zainstaluj aplikację</p>
                <p className={styles.small}>
                  W menu Chrome (⋮) wybierz „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.
                </p>
              </div>
            ) : null}
          </section>
        )}

        {step === 1 && (
          <section aria-labelledby="ob2">
            <h1 id="ob2" className={styles.title}>
              Jak masz na imię?
            </h1>
            <p className={styles.lead}>
              Utworzymy Twój profil — od niego zacznie się zakładka „Mój grafik”.
            </p>
            <GroupedList>
              <TextRow
                label="Imię"
                value={name}
                onChange={setName}
                placeholder="np. Katarzyna"
                autoFocus={false}
                onEnter={() => name.trim() && setStep(2)}
              />
            </GroupedList>
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="ob3">
            <h1 id="ob3" className={styles.title}>
              Godziny domyślne
            </h1>
            <p className={styles.lead}>
              Tak wypełniamy nowe zmiany. Możesz je zmienić teraz lub później w Ustawieniach.
              Skanowanie AI skonfigurujesz później.
            </p>
            <GroupedList>
              <HoursEditor value={hours} onChange={setHours} weekStartsOn={1} />
            </GroupedList>
            {error && (
              <p role="alert" className={styles.warn}>
                {error}
              </p>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        {step < 2 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={step === 1 && name.trim().length === 0}
          >
            Dalej
          </Button>
        ) : (
          <Button onClick={() => void finish()} disabled={busy || !hoursValid(hours)}>
            Gotowe
          </Button>
        )}
      </footer>
    </main>
  );
}
