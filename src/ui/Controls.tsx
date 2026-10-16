import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Minus, Plus } from 'lucide-react';
import { SPRING_BUTTON } from './hooks';
import styles from './Controls.module.css';

export function Button({
  children,
  variant = 'filled',
  destructive = false,
  disabled,
  onClick,
  type = 'button',
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  variant?: 'filled' | 'plain' | 'tinted';
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${styles.button} ${styles[variant]} ${destructive ? styles.destructive : ''} pressable`}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.segment} ${active ? styles.segmentActive : ''}`}
            onClick={() => onChange(o.value)}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className={styles.segmentThumb}
                transition={SPRING_BUTTON}
              />
            )}
            <span className={styles.segmentLabel}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.toggleHit}
      onClick={() => onChange(!checked)}
    >
      <span className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}>
        <motion.span
          className={styles.toggleKnob}
          animate={{ x: checked ? 20 : 0 }}
          transition={SPRING_BUTTON}
        />
      </span>
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className={styles.stepper}>
      <button
        type="button"
        aria-label={`${label}: mniej`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus size={18} strokeWidth={2} />
      </button>
      <span className={styles.stepperDivider} />
      <button
        type="button"
        aria-label={`${label}: więcej`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus size={18} strokeWidth={2} />
      </button>
    </div>
  );
}

export function Spinner({ size = 20, label = 'Ładowanie' }: { size?: number; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={styles.spinner}
      style={{ width: size, height: size }}
    />
  );
}

export function Skeleton({
  width = '100%',
  height = 16,
}: {
  width?: string | number;
  height?: number;
}) {
  return <span aria-hidden="true" className={styles.skeleton} style={{ width, height }} />;
}
