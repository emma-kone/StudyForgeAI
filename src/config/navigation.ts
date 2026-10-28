import {
  BookOpen,
  Database,
  FilePlus2,
  Home,
  Settings,
  Terminal,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { routes } from "@/config/routes";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: "exact" | "prefix";
  alsoActiveFor?: string[];
}

export const APP_NAV: NavItem[] = [
  { href: routes.home, label: "Tableau de bord", icon: Home, match: "exact" },
  { href: routes.library, label: "Bibliothèque", icon: BookOpen, match: "prefix" },
  {
    href: routes.generate,
    label: "Générer des exercices",
    icon: FilePlus2,
    match: "prefix",
    alsoActiveFor: ["/sessions"],
  },
  { href: routes.code, label: "Éditeur de code", icon: Terminal, match: "prefix" },
  { href: routes.sql, label: "Laboratoire SQL", icon: Database, match: "prefix" },
  { href: routes.progress, label: "Progression", icon: TrendingUp, match: "prefix" },
  { href: routes.settings, label: "Réglages", icon: Settings, match: "prefix" },
];

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") {
    if (pathname === item.href) return true;
  } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  return (item.alsoActiveFor ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
