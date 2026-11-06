import { Menu } from "lucide-react";
import { BRAND } from "@/config/brand";
import { titleCase } from "@/lib/format";
import { useAuthStore, useUIStore } from "@/stores";
import { Button } from "@/shared/ui/button";

export default function AppHeader() {
  const user = useAuthStore((s) => s.user);
  const setNavOpen = useUIStore((s) => s.setNavOpen);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "AD";

  return (
    <header className="flex h-[75px] shrink-0 items-center justify-between gap-3 border-b border-grey-50 bg-white px-4 py-4 md:px-6 lg:px-10">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 lg:hidden"
          aria-label="Open navigation menu"
          onClick={() => setNavOpen(true)}
        >
          <Menu className="size-5 text-grey-600" />
        </Button>

        <div className="flex min-w-0 flex-col">
          <span className="text-body truncate text-xs font-semibold text-grey-800 sm:text-sm">
            {BRAND.product}
          </span>
          <span className="text-body hidden truncate text-grey-400 md:block">{BRAND.tagline}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20">
            <span className="text-xs font-semibold text-primary">{initials}</span>
          </div>
          <div className="hidden min-w-0 flex-col sm:flex">
            <span className="text-body text-grey-700 truncate leading-tight font-semibold">
              {user?.name ?? "Admin User"}
            </span>
            <span className="text-body hidden truncate leading-tight text-grey-400 md:block">
              {user ? titleCase(user.role) : ""}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
