import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getConfig, updateLicense, type ConfigResponse } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";

export const LicenseGate = ({
  config,
}: {
  config: ConfigResponse | undefined;
}) => {
  const queryClient = useQueryClient();
  const [licenseKey, setLicenseKey] = useState("");
  const saveLicenseMutation = useMutation({
    mutationFn: updateLicense,
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
      setLicenseKey("");
    },
  });

  const licenseStatus = config?.license.valid
    ? "License đang hoạt động"
    : config?.license.configured
      ? "License key chưa được xác thực"
      : "Chưa có license key trên máy này";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      <Card className="w-full max-w-xl border border-border/70 shadow-lg shadow-black/5">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div className="space-y-1">
              <CardTitle>Kích hoạt license để vào tool</CardTitle>
              <p className="text-sm text-muted-foreground">
                Tool chỉ mở khi Odoo xác nhận license key hợp lệ cho scope hiện tại
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
            <p className="font-medium text-foreground">{licenseStatus}</p>
          </div>

          {saveLicenseMutation.isError ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Không thể kích hoạt license key. Vui lòng kiểm tra lại key.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="license-key">
              License key
            </label>
            <Input
              id="license-key"
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="LIC-XXXX-XXXX-XXXX-XXXX"
              type="password"
              value={licenseKey}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                saveLicenseMutation.isPending ||
                !licenseKey.trim()
              }
              onClick={() =>
                saveLicenseMutation.mutate({
                  licenseKey: licenseKey.trim(),
                })
              }
              type="button"
            >
              {saveLicenseMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Kích hoạt key
            </Button>
            <Button
              disabled={saveLicenseMutation.isPending || !config?.license.configured}
              onClick={() =>
                saveLicenseMutation.mutate({
                  licenseKey: "",
                })
              }
              type="button"
              variant="outline"
            >
              Gỡ key đang lưu
            </Button>
            <Button
              onClick={() => {
                void queryClient.fetchQuery({ queryFn: getConfig, queryKey: ["config"] });
              }}
              type="button"
              variant="ghost"
            >
              Kiểm tra lại
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
