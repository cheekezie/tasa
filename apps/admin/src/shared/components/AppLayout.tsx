import { Outlet } from "react-router-dom";
import { useUIStore } from "@/stores";
import { Sheet, SheetContent } from "@/shared/ui/sheet";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { AppSidebarContent } from "./AppSidebarContent";

const AppLayout = () => {
  const navOpen = useUIStore((s) => s.navOpen);
  const setNavOpen = useUIStore((s) => s.setNavOpen);

  return (
    <div className="flex h-screen overflow-hidden bg-grey-25" data-layout="dashboard">
      <AppSidebar />

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-[280px] p-0 sm:max-w-[280px]" showCloseButton={false}>
          <AppSidebarContent onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main className="scrollbar-hidden flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
