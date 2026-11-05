import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  LogIn,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getConfig,
  getCrawlSession,
  LICENSE_INVALIDATED_EVENT,
  loginCrawlSession,
  testCrawlSession,
  type ConfigResponse,
  type ThreadsSession,
} from "@/lib/api";

export type AppReadinessScope = "all" | "crawl" | "video";

export interface AppReadinessState {
  licenseConfigured: boolean;
  licenseMessage: string;
  licenseValid: boolean;
  config: ConfigResponse | undefined;
  fptConfigured: boolean;
  googleConfigured: boolean;
  ausynclabConfigured: boolean;
  vivibeConfigured: boolean;
  openAiConfigured: boolean;
  hasAnyVoiceProvider: boolean;
  isChecking: boolean;
  isLoggingIn: boolean;
  isRefreshingSession: boolean;
  loginNotice: string;
  loginThreads: () => void;
  refreshSession: () => void;
  session: ThreadsSession | null;
  threadsReady: boolean;
  voiceProviderLabel: string;
}

interface ReadinessItem {
  action?: "login" | "refresh" | "settings";
  description: string;
  ready: boolean;
  title: string;
}

export function useAppReadiness(): AppReadinessState {
  const queryClient = useQueryClient();
  const [loginNotice, setLoginNotice] = useState("");
  const configQuery = useQuery({
    queryFn: getConfig,
    queryKey: ["config"],
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
  const sessionQuery = useQuery({
    queryFn: getCrawlSession,
    queryKey: ["crawl-session"],
    refetchInterval: 30_000,
  });
  const loginMutation = useMutation({
    mutationFn: loginCrawlSession,
    onMutate: () => {
      setLoginNotice("");
    },
    onSuccess: (data) => {
      if (data.session.status === "network_error") {
        setLoginNotice(
          "Không thể kết nối đến Threads trên máy này. Kiểm tra mạng, VPN, firewall hoặc proxy rồi thử lại."
        );
      } else if (data.session.status !== "ready") {
        setLoginNotice(
          "Bạn vừa đóng tab đăng nhập hoặc chưa hoàn tất. Bấm Đăng nhập Threads để thử lại."
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["crawl-session"] });
    },
    onError: (error) => {
      setLoginNotice(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Không mở được phiên đăng nhập Threads. Thử lại sau ít giây."
      );
    },
  });
  const refreshMutation = useMutation({
    mutationFn: testCrawlSession,
    onMutate: () => {
      setLoginNotice("");
    },
    onSuccess: (data) => {
      if (data.session.status === "network_error") {
        setLoginNotice(
          "Máy này vẫn chưa truy cập được Threads. Kiểm tra mạng, VPN, firewall hoặc proxy rồi thử lại."
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["crawl-session"] });
    },
    onError: (error) => {
      setLoginNotice(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Không kiểm tra lại được phiên Threads. Thử lại sau ít giây."
      );
    },
  });

  const config = configQuery.data;
  const session = sessionQuery.data?.session ?? null;
  const threadsReady = session?.status === "ready";
  const licenseConfigured = Boolean(config?.license.configured);
  const licenseValid = Boolean(config?.license.valid);
  const licenseMessage = config?.license.message ?? "";
  const fptConfigured = Boolean(config?.credentials.fptAiApiKeyConfigured);
  const googleConfigured = Boolean(config?.credentials.googleCloudApiKeyConfigured);
  const ausynclabConfigured = Boolean(config?.credentials.ausynclabApiKeyConfigured);
  const vivibeConfigured = Boolean(config?.credentials.vivibeApiKeyConfigured);
  const openAiConfigured = Boolean(config?.credentials.openAiApiKeyConfigured);
  const hasAnyVoiceProvider =
    fptConfigured || googleConfigured || ausynclabConfigured || vivibeConfigured;

  useEffect(() => {
    if (threadsReady) {
      setLoginNotice("");
    }
  }, [threadsReady]);

  useEffect(() => {
    const handleLicenseInvalidated = () => {
      void queryClient.invalidateQueries({ queryKey: ["config"] });
    };

    window.addEventListener(LICENSE_INVALIDATED_EVENT, handleLicenseInvalidated);
    return () => {
      window.removeEventListener(
        LICENSE_INVALIDATED_EVENT,
        handleLicenseInvalidated
      );
    };
  }, [queryClient]);

  return {
    config,
    fptConfigured,
    googleConfigured,
    ausynclabConfigured,
    vivibeConfigured,
    openAiConfigured,
    licenseConfigured,
    licenseMessage,
    licenseValid,
    hasAnyVoiceProvider,
    isChecking:
      (configQuery.isLoading && !configQuery.data) ||
      (sessionQuery.isLoading && !sessionQuery.data),
    isLoggingIn: loginMutation.isPending,
    isRefreshingSession: refreshMutation.isPending,
    loginNotice,
    loginThreads: () => loginMutation.mutate(),
    refreshSession: () => refreshMutation.mutate(),
    session,
    threadsReady,
    voiceProviderLabel: hasAnyVoiceProvider
      ? [
          fptConfigured && "FPT Voice",
          googleConfigured && "Google Voice",
          ausynclabConfigured && "AuSyncLab",
          vivibeConfigured && "ViVibe",
        ]
          .filter(Boolean)
          .join(" + ")
      : "Chưa cấu hình",
  };
}

export const AppReadinessPanel = ({
  scope,
  showWhenReady = false,
  state,
}: {
  scope: AppReadinessScope;
  showWhenReady?: boolean;
  state: AppReadinessState;
}) => {
  const items = buildItems(scope, state);
  const missingCount = items.filter((item) => !item.ready).length;

  if (state.isChecking) {
    return (
      <Card className="border border-border/70 bg-card/80 shadow-none">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Đang kiểm tra trạng thái sử dụng trên máy này...
        </CardContent>
      </Card>
    );
  }

  if (!showWhenReady && missingCount === 0) {
    return null;
  }

  return (
    <Card className="border border-border/70 bg-card/90 shadow-none">
      <CardHeader className="gap-2 border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {missingCount === 0 ? "Sẵn sàng sử dụng" : "Cần hoàn tất trước khi dùng"}
            </CardTitle>
          </div>
          <Badge variant={missingCount === 0 ? "default" : "secondary"}>
            {missingCount === 0 ? "Đã sẵn sàng" : `Thiếu ${missingCount} bước`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        {items.map((item) => (
          <div
            className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/80 p-3"
            key={item.title}
          >
            <div className="flex items-start gap-3">
              {item.ready ? (
                <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 text-amber-600" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.title}</span>
                  <Badge variant={item.ready ? "outline" : "secondary"}>
                    {item.ready ? "OK" : "Chưa xong"}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </div>
            {!item.ready ? (
              <div className="pl-7">
                {item.action === "login" ? (
                  <Button
                    disabled={state.isLoggingIn}
                    onClick={state.loginThreads}
                    size="sm"
                    type="button"
                  >
                    {state.isLoggingIn ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <LogIn />
                    )}
                    Đăng nhập Threads
                  </Button>
                ) : item.action === "refresh" ? (
                  <Button
                    disabled={state.isRefreshingSession}
                    onClick={state.refreshSession}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {state.isRefreshingSession ? (
                      <LoaderCircle className="animate-spin" />
                    ) : null}
                    Kiểm tra lại
                  </Button>
                ) : item.action === "settings" ? (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/settings">
                      <Settings2 />
                      Mở Cài đặt
                    </Link>
                  </Button>
                ) : null}
                {item.action === "login" && state.isLoggingIn ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Tool đang chờ bạn đăng nhập trong trình duyệt. Nếu bạn đóng tab này,
                    trạng thái sẽ quay lại bình thường sau vài giây.
                  </p>
                ) : null}
                {state.loginNotice ? (
                  <p className="mt-2 text-xs text-amber-600">{state.loginNotice}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

function buildItems(
  scope: AppReadinessScope,
  state: AppReadinessState,
): ReadinessItem[] {
  const items: ReadinessItem[] = [];

  if (scope === "all") {
    items.push({
      action: state.licenseValid ? undefined : "settings",
      description: state.licenseValid
        ? "License key đã được Odoo xác nhận hợp lệ cho máy này."
        : state.licenseConfigured
          ? state.licenseMessage || "License key hiện chưa được Odoo chấp nhận."
          : "Cần nhập license key hợp lệ từ Odoo trước khi dùng tool.",
      ready: state.licenseValid,
      title: "License key",
    });
  }

  if (scope === "all" || scope === "crawl") {
    const networkIssue = state.session?.status === "network_error";
    items.push({
      action: state.threadsReady ? undefined : networkIssue ? "refresh" : "login",
      description: state.threadsReady
        ? `Đã đăng nhập bằng ${resolveSessionLabel(state.session)}. Có thể bắt đầu crawl ngay.`
        : networkIssue
          ? "Máy này đang không truy cập được Threads. Kiểm tra internet, VPN, firewall hoặc proxy, sau đó bấm Kiểm tra lại trước khi crawl."
          : "Cần đăng nhập Threads trên máy này trước khi crawl. Khi bấm Đăng nhập, tool sẽ mở trình duyệt để lưu phiên local.",
      ready: state.threadsReady,
      title: "Phiên Threads",
    });
  }

  if (scope === "all" || scope === "video") {
    items.push({
      action: state.hasAnyVoiceProvider ? undefined : "settings",
      description: state.hasAnyVoiceProvider
        ? `Đã có ${state.voiceProviderLabel}. Có thể tạo voice và dựng video trên máy này.`
        : "Video cần ít nhất 1 API voice. Vào Cài đặt rồi dán AuSyncLab, FPT Voice, Google Voice hoặc ViVibe, sau đó bấm Lưu và Kiểm tra.",
      ready: state.hasAnyVoiceProvider,
      title: "API voice cho video",
    });
  }

  return items;
}

function resolveSessionLabel(session: ThreadsSession | null): string {
  return (
    session?.accountLabel?.trim() ||
    session?.accountDisplayName?.trim() ||
    session?.accountUsername?.trim() ||
    "tài khoản hiện tại"
  );
}
