import { NavLink, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";
import { bottomNavItems, navSections } from "@/config/navigation";
import appRoutes from "@/routes/appRoutes";
import { hasRole, useAuthStore } from "@/stores";

function NavItem({
  label,
  icon: Icon,
  to,
  exact = false,
  onNavigate,
}: {
  label: string;
  icon: React.ElementType;
  to: string;
  exact?: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <NavLink
      to={to}
      end={exact}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex cursor-pointer! items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-primary/30 font-medium text-green-7"
            : "text-grey-400 hover:bg-grey-25 hover:text-grey-800",
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </NavLink>
  );
}

type AppSidebarContentProps = {
  onNavigate?: () => void;
};

export function AppSidebarContent({ onNavigate }: AppSidebarContentProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  // Only what this admin's role can open; the API refuses the rest anyway.
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles?.length || hasRole(user, ...item.roles)),
    }))
    .filter((section) => section.items.length > 0);
  const visibleBottomNavItems = bottomNavItems;

  const handleSignOut = () => {
    onNavigate?.();
    void logout();
    navigate(appRoutes.AUTH.LOGIN, { replace: true });
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[75px] items-center gap-3 border-b border-grey-50 px-5 py-4">
        <img src={BRAND.logoUrl} alt={BRAND.name} className="h-8 shrink-0 object-contain" />
        <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
          Admin
        </span>
      </div>

      <nav className="scrollbar-hidden flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {visibleNavSections.map((section) => (
          <div key={section.label}>
            <p className="text-caption mb-1 px-3 tracking-widest text-grey-300 uppercase">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.to} {...item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-grey-50 px-3 py-4">
        {visibleBottomNavItems.map((item) => (
          <NavItem key={item.to} {...item} onNavigate={onNavigate} />
        ))}
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-grey-500 transition-colors hover:bg-grey-25 hover:text-grey-800"
        >
          <LogOut className="size-4 shrink-0" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
