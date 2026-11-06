import { AppSidebarContent } from "./AppSidebarContent";

export default function AppSidebar() {
  return (
    <aside className="hidden h-screen w-[232px] shrink-0 flex-col border-r border-grey-50 bg-white lg:flex">
      <AppSidebarContent />
    </aside>
  );
}
