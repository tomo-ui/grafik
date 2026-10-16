import { useEffect, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { ChevronLeft, GripVertical, Plus } from 'lucide-react';
import { useLocation } from 'wouter';
import { Button, GroupedList, ListRow, Screen } from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { colorVar, initials, nextColor } from '../../domain/people';
import type { Person } from '../../domain/types';
import { PersonEditor } from './PersonEditor';
import styles from './Settings.module.css';

function PersonRow({
  person,
  last,
  onOpen,
  onDrop,
}: {
  person: Person;
  last: boolean;
  onOpen: () => void;
  onDrop: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={person}
      dragListener={false}
      dragControls={controls}
      className={styles.reorderItem}
      onDragEnd={onDrop}
    >
      <ListRow
        title={[person.firstName, person.lastName].filter(Boolean).join(' ')}
        subtitle={
          [person.isMe ? 'To ja' : '', person.archived ? 'Zarchiwizowana' : '']
            .filter(Boolean)
            .join(' · ') || undefined
        }
        leading={
          <span className={styles.avatar} style={{ background: colorVar(person.color) }}>
            {initials(person)}
          </span>
        }
        trailing={
          <span
            className={styles.grip}
            role="img"
            aria-label={`Przeciągnij, aby zmienić kolejność: ${person.firstName}`}
            onPointerDown={(e) => controls.start(e)}
          >
            <GripVertical size={20} />
          </span>
        }
        onClick={onOpen}
        last={last}
      />
    </Reorder.Item>
  );
}

export function PeopleScreen() {
  const persons = usePersons(true);
  const [, navigate] = useLocation();
  const [items, setItems] = useState<Person[]>([]);
  const itemsRef = useRef<Person[]>([]);
  const [editing, setEditing] = useState<Person | null | undefined>(undefined); // undefined = zamknięty
  const [editorKey, setEditorKey] = useState(0);

  // synchronizacja kolejności lokalnej z bazą (źródło prawdy), poza trwającym przeciąganiem
  useEffect(() => {
    if (persons) {
      itemsRef.current = persons;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lustro danych z liveQuery pod Reorder
      setItems(persons);
    }
  }, [persons]);

  const reorder = (next: Person[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const persist = () => {
    repos.persons.reorder(itemsRef.current.map((p) => p.id)).catch(console.error);
  };

  const open = (p: Person | null) => {
    setEditorKey((k) => k + 1);
    setEditing(p);
  };

  return (
    <Screen
      title="Osoby"
      leading={
        <button type="button" className={styles.backBtn} onClick={() => navigate('/settings')}>
          <ChevronLeft size={22} /> Wróć
        </button>
      }
    >
      {persons && persons.length === 0 ? (
        <div className={styles.empty}>
          <p>Nie ma jeszcze żadnych osób.</p>
          <Button onClick={() => open(null)}>
            <Plus size={18} /> Dodaj osobę
          </Button>
        </div>
      ) : (
        <>
          <GroupedList footer="Kolejność tutaj jest kolejnością w widoku zespołu. Przytrzymaj uchwyt, aby przesunąć.">
            <Reorder.Group
              as="div"
              axis="y"
              values={items}
              onReorder={reorder}
              className={styles.reorderGroup}
            >
              {items.map((p, i) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  last={i === items.length - 1}
                  onOpen={() => open(p)}
                  onDrop={persist}
                />
              ))}
            </Reorder.Group>
          </GroupedList>
          <div className={styles.formActions}>
            <Button variant="tinted" onClick={() => open(null)}>
              <Plus size={18} /> Dodaj osobę
            </Button>
          </div>
        </>
      )}

      <PersonEditor
        key={editorKey}
        open={editing !== undefined}
        person={editing ?? null}
        suggestedColor={nextColor((persons ?? []).map((p) => p.color))}
        onClose={() => setEditing(undefined)}
      />
    </Screen>
  );
}
