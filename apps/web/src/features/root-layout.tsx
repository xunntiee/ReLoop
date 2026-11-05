import { Link, Outlet } from "@tanstack/react-router";

export const RootLayout = () => (
  <main className="min-h-screen bg-background text-foreground">
    <nav
      aria-label="Primary"
      className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-1 px-4 sm:px-6 lg:px-8">
        <Link
          activeProps={{ className: "bg-muted text-foreground" }}
          className="rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
          to="/"
        >
          Crawl
        </Link>
        <Link
          activeProps={{ className: "bg-muted text-foreground" }}
          className="rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
          to="/settings"
        >
          Config
        </Link>
      </div>
    </nav>
    <Outlet />
  </main>
);
