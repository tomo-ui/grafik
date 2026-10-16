import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { SPRING_BUTTON } from './hooks';
import styles from './TabBar.module.css';

export interface Tab {
  id: string;
  label: string;
  icon: ReactNode;
}

/**
 * Pływająca kapsuła glass z „soczewką” przesuwaną sprężyną.
 * `compact` (przewijanie w dół) chowa etykiety i zmniejsza kapsułę.
 */
export function TabBar({
  tabs,
  active,
  onChange,
  compact = false,
  action,
}: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  compact?: boolean;
  /** okrągły przycisk akcji obok kapsuły (np. „+”) */
  action?: ReactNode;
}) {
  return (
    <nav className={styles.wrap} aria-label="Główna nawigacja">
      <div className={`${styles.capsule} glass ${compact ? styles.compact : ''}`}>
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              className={`${styles.tab} ${isActive ? styles.active : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onChange(t.id)}
            >
              {isActive && (
                <motion.span
                  layoutId="tab-lens"
                  className={styles.lens}
                  transition={SPRING_BUTTON}
                />
              )}
              <span className={styles.icon}>{t.icon}</span>
              <span className={styles.label}>{t.label}</span>
            </button>
          );
        })}
      </div>
      {action}
    </nav>
  );
}
