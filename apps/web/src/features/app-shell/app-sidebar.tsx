import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Clapperboard,
  Database,
  FolderOpen,
  Image as ImageIcon,
  LogOut,
  Music,
  Settings,
  ShieldCheck,
  Video,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { logoutCrawlSession, type ThreadsSession } from "@/lib/api";
import { useAppReadiness } from "./app-readiness";
import { ThemeToggle } from "./theme-toggle";

export const AppSidebar = () => {
  const queryClient = useQueryClient();
  const readiness = useAppReadiness();
  const session = readiness.session;
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: logoutCrawlSession,
    onSuccess: () => {
      setConfirmLogoutOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["crawl-session"] });
      void queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
    },
  });

  const canLogout = Boolean(session?.exists);

  return (
    <>
      {confirmLogoutOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-2xl border bg-background p-5 shadow-xl">
            <div className="space-y-2">
              <h3 className="text-base font-semibold">Đăng xuất phiên Threads?</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                Bạn có chắc muốn đăng xuất phiên Threads hiện tại không? 
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                onClick={() => setConfirmLogoutOpen(false)}
                type="button"
                variant="outline"
              >
                Hủy
              </Button>
              <Button
                disabled={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
                type="button"
                variant="destructive"
              >
                <LogOut className="h-4 w-4" />
                {logoutMutation.isPending ? "Đang đăng xuất" : "Đăng xuất"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <aside className="hidden h-full w-56 shrink-0 flex-col border-r bg-muted/20 lg:flex">
        <div className="flex h-14 items-center justify-between border-b px-3 lg:h-16">
          <span className="text-base font-semibold tracking-tight">Post to Video</span>
          <ThemeToggle />
        </div>

        <nav className="flex-1 overflow-auto py-4">
          <ul className="grid gap-1 px-2 text-sm font-medium">
            <li>
              <SidebarLink icon={<Database className="h-4 w-4" />} label="Crawl dữ liệu" to="/" />
            </li>
            <li>
              <SidebarLink
                icon={<Video className="h-4 w-4" />}
                label="Làm video tự động"
                to="/video"
              />
            </li>
            <li>
              <SidebarLink
                icon={<Clapperboard className="h-4 w-4" />}
                label="Làm video nâng cao"
                to="/video-v2"
              />
            </li>
            <li>
              <SidebarLink
                icon={<FolderOpen className="h-4 w-4" />}
                label="Thư viện video"
                to="/video-library"
              />
            </li>
            <li>
              <SidebarLink
                icon={<ImageIcon className="h-4 w-4" />}
                label="Thư viện meme"
                to="/meme-library"
              />
            </li>
            <li>
              <SidebarLink
                icon={<Music className="h-4 w-4" />}
                label="Thư viện nhạc nền"
                to="/music-library"
              />
            </li>
            <li className="mt-4">
              <SidebarLink icon={<Settings className="h-4 w-4" />} label="Cài đặt" to="/settings" />
            </li>
          </ul>
        </nav>

        <div className="border-t p-2.5">
          <div className="grid gap-3 rounded-lg border bg-background p-2.5 text-sm shadow-sm">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
              <div className="grid min-w-0 flex-1 gap-1">
                <span className="font-medium">Phiên Threads</span>
                <SessionStatusText session={session} />
                {session?.accountLabel ? (
                  <span className="truncate text-sm font-semibold" title={session.accountLabel}>
                    {session.accountLabel}
                  </span>
                ) : null}
                {session?.accountDisplayName ? (
                  <span
                    className="truncate text-xs text-muted-foreground"
                    title={session.accountDisplayName}
                  >
                    {session.accountDisplayName}
                  </span>
                ) : null}
              </div>
            </div>

            <Button
              disabled={!canLogout || logoutMutation.isPending}
              onClick={() => setConfirmLogoutOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <LogOut className="h-4 w-4" />
              Đăng xuất phiên local
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};

const SidebarLink = ({
  icon,
  label,
  to,
}: {
  icon: ReactNode;
  label: string;
  to:
    | "/"
    | "/video"
    | "/video-v2"
    | "/video-library"
    | "/meme-library"
    | "/music-library"
    | "/history"
    | "/settings";
}) => (
  <Link
    activeOptions={{ exact: to === "/" }}
    activeProps={{
      className:
        "bg-muted font-bold text-foreground shadow-xs ring-1 ring-border dark:bg-muted/70 dark:text-foreground dark:ring-border",
    }}
    className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
    to={to}
  >
    <span className="shrink-0">{icon}</span>
    <span>{label}</span>
  </Link>
);

const SessionStatusText = ({ session }: { session: ThreadsSession | null }) => {
  if (!session) {
    return <span className="text-xs text-muted-foreground">Đang tải trạng thái</span>;
  }

  if (session.status === "ready") {
    return (
      <span className="text-xs text-primary">Đã đăng nhập - {session.cookieCount} cookies</span>
    );
  }

  if (session.status === "network_error") {
    return <span className="text-xs text-amber-600">Không kết nối được đến Threads từ máy này</span>;
  }

  if (session.status === "needs_login") {
    return <span className="text-xs text-amber-600">Có phiên cũ nhưng cần đăng nhập lại</span>;
  }

  return <span className="text-xs text-muted-foreground">Chưa đăng nhập</span>;
};
