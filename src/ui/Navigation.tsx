import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { SPRING_BUTTON } from './hooks';
import styles from './Navigation.module.css';

/**
 * Ekran z Large Title zwijanym do małego tytułu (IntersectionObserver na dużym tytule).
 * Przewija się wewnętrzny kontener, nie body.
 */
export function Screen({
  title,
  trailing,
  children,
  onScrollDirection,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
  /** dla TabBar: zmniejszanie przy przewijaniu w dół */
  onScrollDirection?: (dir: 'up' | 'down') => void;
}) {
  const sentinel = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    const root = scroller.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e?.isIntersecting), {
      root,
      threshold: 0,
      rootMargin: '-52px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const root = scroller.current;
    if (!root || !onScrollDirection) return;
    let last = root.scrollTop;
    const onScroll = () => {
      const cur = root.scrollTop;
      if (Math.abs(cur - last) > 8) {
        onScrollDirection(cur > last && cur > 40 ? 'down' : 'up');
        last = cur;
      }
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [onScrollDirection]);

  return (
    <div className={styles.screen}>
      <header className={`${styles.bar} ${collapsed ? `${styles.barCollapsed} glass` : ''}`}>
        <span className={styles.barSide} />
        <motion.span
          className={styles.smallTitle}
          initial={false}
          animate={{ opacity: collapsed ? 1 : 0, y: collapsed ? 0 : 6 }}
          transition={SPRING_BUTTON}
          aria-hidden={!collapsed}
        >
          {title}
        </motion.span>
        <span className={`${styles.barSide} ${styles.barTrailing}`}>{trailing}</span>
      </header>
      <div ref={scroller} className={styles.scroller}>
        <h1 ref={sentinel} className={styles.largeTitle}>
          {title}
        </h1>
        {children}
        <div className={styles.bottomSpace} />
      </div>
    </div>
  );
}
