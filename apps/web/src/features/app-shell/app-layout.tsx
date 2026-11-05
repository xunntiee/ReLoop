import { Outlet, useRouterState } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useAppReadiness } from "./app-readiness";
import { AppSidebar } from "./app-sidebar";
import { LicenseGate } from "./license-gate";
import { PrerequisiteGate } from "./prerequisite-gate";
import { ThemeToggle } from "./theme-toggle";

export const AppLayout = () => {
  const readiness = useAppReadiness();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (readiness.isChecking && !readiness.config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  if (!readiness.licenseValid) {
    return <LicenseGate config={readiness.config} />;
  }

  const prerequisitesReady =
    readiness.threadsReady && readiness.hasAnyVoiceProvider;
  if (!prerequisitesReady && pathname !== "/settings") {
    return <PrerequisiteGate state={readiness} />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Top bar for mobile only */}
        <div className="flex h-14 items-center justify-between border-b px-4 lg:hidden">
          <span className="font-semibold text-lg tracking-tight">Post to Video</span>
          <ThemeToggle />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
