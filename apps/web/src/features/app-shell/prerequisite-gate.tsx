import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { AppReadinessPanel, type AppReadinessState } from "./app-readiness";

export const PrerequisiteGate = ({ state }: { state: AppReadinessState }) => (
  <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
    <Card className="w-full max-w-2xl border border-border/70 shadow-black/5 shadow-lg">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <div className="space-y-1">
            <CardTitle>Hoàn tất thiết lập để bắt đầu dùng</CardTitle>
            <p className="text-muted-foreground text-sm">
              Tool chỉ mở chức năng crawl và video khi license, phiên Threads và
              Voice API đều sẵn sàng.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <AppReadinessPanel scope="all" showWhenReady state={state} />
        {state.hasAnyVoiceProvider ? null : (
          <Button asChild className="w-full sm:w-auto" type="button">
            <Link to="/settings">
              Nhập Voice API trong Cài đặt
              <ArrowRight />
            </Link>
          </Button>
        )}
        <p className="text-muted-foreground text-xs leading-5">
          Trong lúc chưa đủ điều kiện, bạn chỉ có thể mở Cài đặt, nhập API key
          và đăng nhập Threads. Mọi API nghiệp vụ khác đều bị khóa ở server.
        </p>
      </CardContent>
    </Card>
  </div>
);
