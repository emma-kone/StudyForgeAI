"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAV, isNavActive } from "@/config/navigation";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/store/app-store";

interface SidebarNavProps {
  user: AppUser | null;
  onLogout: () => void;
}

export function SidebarNav({ user, onLogout }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <aside
      className="hidden md:flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground sticky top-0 h-screen"
      aria-label="Navigation principale"
    >
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <p className="typo-h3 leading-tight">StudyForge AI</p>
          <p className="typo-meta">Apprentissage assisté par IA</p>
        </div>
      </div>
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {APP_NAV.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t px-4 py-3">
        <p className="typo-meta truncate">{user?.email}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className="mt-1 w-full justify-start gap-2 text-muted-foreground"
        >
          <LogOut className="h-4 w-4" aria-hidden /> Se déconnecter
        </Button>
      </div>
    </aside>
  );
}
