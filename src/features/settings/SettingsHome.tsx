import { Clock, History, Info, ScanLine, Users } from 'lucide-react';
import { useLocation } from 'wouter';
import { GroupedList, ListRow, Screen, SegmentedControl } from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { useInstall } from '../../app/install';
import { PEOPLE, plural } from '../../domain/i18n';
import type { Settings } from '../../domain/types';
import { DataSection } from './DataSection';

export function SettingsHome({ settings }: { settings: Settings }) {
  const [, navigate] = useLocation();
  const persons = usePersons();
  const install = useInstall();

  return (
    <Screen title="Ustawienia">
      <GroupedList header="Zespół">
        <ListRow
          title="Osoby"
          leading={<Users size={22} color="var(--accent)" />}
          value={persons ? plural(persons.length, PEOPLE) : undefined}
          chevron
          onClick={() => navigate('/settings/people')}
        />
        <ListRow
          title="Godziny domyślne"
          leading={<Clock size={22} color="var(--accent)" />}
          chevron
          onClick={() => navigate('/settings/hours')}
          last
        />
      </GroupedList>

      <GroupedList header="Skanowanie AI">
        <ListRow
          title="Skanowanie AI"
          leading={<ScanLine size={22} color="var(--accent)" />}
          value={settings.geminiApiKey ? 'Skonfigurowane' : 'Brak klucza'}
          chevron
          onClick={() => navigate('/settings/ai')}
        />
        <ListRow
          title="Historia importów"
          leading={<History size={22} color="var(--accent)" />}
          chevron
          onClick={() => navigate('/settings/imports')}
          last
        />
      </GroupedList>

      <GroupedList header="Kalendarz">
        <ListRow
          title="Pierwszy dzień tygodnia"
          trailing={
            <SegmentedControl
              label="Pierwszy dzień tygodnia"
              value={settings.weekStartsOn === 1 ? 'mon' : 'sun'}
              onChange={(v) => void repos.settings.update({ weekStartsOn: v === 'mon' ? 1 : 0 })}
              options={[
                { value: 'mon', label: 'Pn' },
                { value: 'sun', label: 'Nd' },
              ]}
            />
          }
          last
        />
      </GroupedList>

      <GroupedList header="Wygląd">
        <ListRow
          title="Motyw"
          trailing={
            <SegmentedControl
              label="Motyw"
              value={settings.theme}
              onChange={(v) => void repos.settings.update({ theme: v })}
              options={[
                { value: 'system', label: 'Auto' },
                { value: 'light', label: 'Jasny' },
                { value: 'dark', label: 'Ciemny' },
              ]}
            />
          }
          last
        />
      </GroupedList>

      <DataSection />

      <GroupedList header="O aplikacji">
        <ListRow
          title="Wersja"
          leading={<Info size={22} color="var(--accent)" />}
          value={__APP_VERSION__}
        />
        <ListRow
          title="Instalacja"
          value={install.standalone ? 'Zainstalowana' : 'W przeglądarce'}
          last
        />
      </GroupedList>
    </Screen>
  );
}
