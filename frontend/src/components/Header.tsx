import { Dices, Waypoints } from 'lucide-react';
import { Link } from 'react-router-dom';

import { HealthBadge } from './HealthBadge';
import { SearchBar } from './SearchBar';
import { ThemeToggle } from './ThemeToggle';

import styles from './Header.module.css';

export function Header() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.logo} aria-label="WikiGraph home">
        <Waypoints size={20} aria-hidden="true" />
        <span className={styles.logoText}>WikiGraph</span>
      </Link>
      <div className={styles.search}>
        <SearchBar />
      </div>
      <nav className={styles.actions}>
        <Link to="/random" className={styles.random} aria-label="Open a random article">
          <Dices size={16} aria-hidden="true" />
          <span className={styles.randomText}>Random</span>
        </Link>
        <ThemeToggle />
        <HealthBadge />
      </nav>
    </header>
  );
}
