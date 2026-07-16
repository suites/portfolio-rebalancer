"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CONSOLE_NAVIGATION } from "./navigation";
import styles from "./app-shell.module.css";

export function SideNavigation() {
  const pathname = usePathname();
  return (
    <nav className={styles.navigation} aria-label="주요 메뉴">
      {CONSOLE_NAVIGATION.map(({ href, label }) => {
        const active = href === "/" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            className={active ? styles.activeNav : styles.navItem}
            href={href}
            aria-current={active ? "page" : undefined}
            key={href}
          >
            <span className={styles.navMarker} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
