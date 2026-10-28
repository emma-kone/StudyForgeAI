"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAV, isNavActive } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function MobileNav({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();

  return (
    <header className="md:hidden sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5" aria-hidden />
          <span className="font-semibold">StudyForge AI</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onLogout}>
          <LogOut className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label="Navigation mobile">
        {APP_NAV.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
