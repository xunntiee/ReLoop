import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAppReadiness } from "@/features/app-shell/app-readiness";
import {
  getConfig,
  getPortableUpdateStatus,
  getVideoAbbreviations,
  importPortableUpdate,
  importVideoAbbreviationsFromUrl,
  testConfigCredential,
  updateConfigCredentials,
  updateLicense,
  updateVideoAbbreviations,
} from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  KeyRound,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";

type CredentialProvider = "ausynclab" | "fpt" | "google" | "openai" | "vivibe";

export const SettingsPage = () => {
  const queryClient = useQueryClient();
  const readiness = useAppReadiness();
  const configQuery = useQuery({
    queryFn: getConfig,
    queryKey: ["config"],
  });
  const [ausynclabApiKey, setAusynclabApiKey] = useState("");
  const [fptAiApiKey, setFptAiApiKey] = useState("");
  const [googleCloudApiKey, setGoogleCloudApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [vivibeApiKey, setVivibeApiKey] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [abbreviationSheetUrl, setAbbreviationSheetUrl] = useState("");
  const [abbreviationImportMessage, setAbbreviationImportMessage] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const abbreviationImportInputRef = useRef<HTMLInputElement | null>(null);
  const portableUpdateInputRef = useRef<HTMLInputElement | null>(null);

  const config = configQuery.data;
  const abbreviationsQuery = useQuery({
    queryFn: getVideoAbbreviations,
    queryKey: ["video-abbreviations"],
  });
  const portableUpdateQuery = useQuery({
    queryFn: getPortableUpdateStatus,
    queryKey: ["portable-update-status"],
    retry: false,
  });

  const saveCredentialsMutation = useMutation({
    mutationFn: updateConfigCredentials,
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
      void queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });

  const testCredentialMutation = useMutation({
    mutationFn: testConfigCredential,
  });

  const saveLicenseMutation = useMutation({
    mutationFn: updateLicense,
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
      setLicenseKey("");
    },
  });

  const importAbbreviationsMutation = useMutation({
    mutationFn: updateVideoAbbreviations,
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["video-abbreviations"], data);
      setAbbreviationImportMessage(
        `Da import ${Object.keys(variables).length} tu viet tat vao tu dien cua app.`
      );
    },
  });

  const importAbbreviationsFromUrlMutation = useMutation({
    mutationFn: importVideoAbbreviationsFromUrl,
    onSuccess: (data) => {
      queryClient.setQueryData(["video-abbreviations"], data);
      setAbbreviationSheetUrl("");
      setAbbreviationImportMessage(
        `Da import ${Object.keys(data.abbreviations ?? {}).length} tu tu sheet online vao tu dien cua app.`
      );
    },
  });

  const importPortableUpdateMutation = useMutation({
    mutationFn: importPortableUpdate,
    onSuccess: (data) => {
      setUpdateMessage(data.message);
    },
  });

  const savingProvider = useMemo(() => {
    const variables = saveCredentialsMutation.variables;
    if (variables?.ausynclabApiKey !== undefined) return "ausynclab";
    if (variables?.fptAiApiKey !== undefined) return "fpt";
    if (variables?.googleCloudApiKey !== undefined) return "google";
    if (variables?.openAiApiKey !== undefined) return "openai";
    if (variables?.vivibeApiKey !== undefined) return "vivibe";
    return null;
  }, [saveCredentialsMutation.variables]);

  const handleSaveCredential = (provider: CredentialProvider) => {
    if (provider === "ausynclab") {
      const value = ausynclabApiKey.trim();
      if (!value) return;
      saveCredentialsMutation.mutate({ ausynclabApiKey: value });
      return;
    }

    if (provider === "fpt") {
      const value = fptAiApiKey.trim();
      if (!value) return;
      saveCredentialsMutation.mutate({ fptAiApiKey: value });
      return;
    }

    if (provider === "vivibe") {
      const value = vivibeApiKey.trim();
      if (!value) return;
      saveCredentialsMutation.mutate({ vivibeApiKey: value });
      return;
    }

    if (provider === "openai") {
      const value = openAiApiKey.trim();
      if (!value) return;
      saveCredentialsMutation.mutate({ openAiApiKey: value });
      return;
    }

    const value = googleCloudApiKey.trim();
    if (!value) return;
    saveCredentialsMutation.mutate({ googleCloudApiKey: value });
  };

  const handleClearCredential = (provider: CredentialProvider) => {
    saveCredentialsMutation.mutate(
      provider === "ausynclab"
        ? { ausynclabApiKey: "" }
        : provider === "fpt"
          ? { fptAiApiKey: "" }
          : provider === "openai"
            ? { openAiApiKey: "" }
          : provider === "vivibe"
            ? { vivibeApiKey: "" }
            : { googleCloudApiKey: "" },
    );
  };

  const handleTestCredential = (provider: CredentialProvider) => {
    testCredentialMutation.mutate(buildCredentialTestPayload(provider));
  };

  const buildCredentialTestPayload = (provider: CredentialProvider) => {
    if (provider === "ausynclab") {
      return {
        provider,
        ...(ausynclabApiKey.trim()
          ? { ausynclabApiKey: ausynclabApiKey.trim() }
          : {}),
      };
    }
    if (provider === "fpt") {
      return {
        provider,
        ...(fptAiApiKey.trim() ? { fptAiApiKey: fptAiApiKey.trim() } : {}),
      };
    }
    if (provider === "google") {
      return {
        provider,
        ...(googleCloudApiKey.trim()
          ? { googleCloudApiKey: googleCloudApiKey.trim() }
          : {}),
      };
    }
    if (provider === "openai") {
      return {
        provider,
        ...(openAiApiKey.trim() ? { openAiApiKey: openAiApiKey.trim() } : {}),
      };
    }
    return {
      provider,
      ...(vivibeApiKey.trim() ? { vivibeApiKey: vivibeApiKey.trim() } : {}),
    };
  };

  const handleImportAbbreviationsClick = () => {
    abbreviationImportInputRef.current?.click();
  };

  const handleImportPortableUpdateClick = () => {
    portableUpdateInputRef.current?.click();
  };

  const handleImportPortableUpdate = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setUpdateMessage("Hãy chọn file ZIP portable mới của Tool.");
      return;
    }
    setUpdateMessage(`Đang tải ${file.name} lên để cập nhật...`);
    importPortableUpdateMutation.mutate(file);
  };

  const handleImportAbbreviationsFromUrl = () => {
    const url = abbreviationSheetUrl.trim();
    if (!url) {
      setAbbreviationImportMessage("Hay nhap link sheet online truoc khi import.");
      return;
    }

    setAbbreviationImportMessage("Dang tai du lieu tu sheet online...");
    importAbbreviationsFromUrlMutation.mutate({
      merge: true,
      url,
    });
  };

  const handleExportAbbreviations = () => {
    const abbreviations = abbreviationsQuery.data?.abbreviations ?? {};
    const csv = withUtf8Bom(serializeAbbreviationCsv(abbreviations));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = objectUrl;
    link.download = `abbreviations-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
    setAbbreviationImportMessage("Da xuat file CSV tu tu dien hien tai tren may.");
  };

  const handleImportAbbreviationsFile = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const imported = parseImportedAbbreviationCsv(content);
      const importedCount = Object.keys(imported).length;
      if (importedCount === 0) {
        throw new Error("File CSV chưa có 2 cột hợp lệ cho viết tắt và đọc thành.");
      }

      const current = abbreviationsQuery.data?.abbreviations ?? {};
      importAbbreviationsMutation.mutate({
        ...current,
        ...imported,
      });
      setAbbreviationImportMessage(
        `Dang import ${importedCount} tu tu file ${file.name}...`
      );
    } catch (error) {
      setAbbreviationImportMessage(
        error instanceof Error ? `Import thất bại: ${error.message}` : "Import thất bại."
      );
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          Cấu hình dùng riêng cho máy này. Đồng nghiệp chỉ cần đăng nhập Threads
          và dán API voice tại đây.
        </p>
      </div>

      {configQuery.isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {configQuery.error.message}
        </p>
      ) : null}

      {saveCredentialsMutation.isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {saveCredentialsMutation.error.message}
        </p>
      ) : null}

      {testCredentialMutation.isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {testCredentialMutation.error.message}
        </p>
      ) : null}

      {testCredentialMutation.data?.ok ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {testCredentialMutation.data.message}
        </p>
      ) : null}

      {importAbbreviationsMutation.isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {importAbbreviationsMutation.error.message}
        </p>
      ) : null}

      {importAbbreviationsFromUrlMutation.isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {importAbbreviationsFromUrlMutation.error.message}
        </p>
      ) : null}

      {saveLicenseMutation.isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {saveLicenseMutation.error.message}
        </p>
      ) : null}

      {importPortableUpdateMutation.isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {importPortableUpdateMutation.error.message}
        </p>
      ) : null}

      <Card className="border border-border/70 shadow-none" size="sm">
        <CardContent className="flex flex-wrap items-center gap-1 px-3 py-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-foreground mr-1">Trạng thái:</span>
          <CompactStatusChip
            label="Threads"
            ok={readiness.threadsReady}
            value={readiness.threadsReady ? "Đã đăng nhập" : "Cần đăng nhập"}
          />
          <CompactStatusChip
            label="Voice API"
            ok={readiness.hasAnyVoiceProvider}
            value={
              readiness.hasAnyVoiceProvider
                ? readiness.voiceProviderLabel
                : "Chưa có key"
            }
          />
          <CompactStatusChip
            label="Lưu dữ liệu"
            ok
            value="Riêng trên máy này"
          />
          <CompactStatusChip
            label="License"
            ok={Boolean(config?.license.configured)}
            value={
              config?.license.configured
                ? config.license.keyPreview || "Đã lưu key"
                : "Chưa nhập"
            }
          />
          {!readiness.threadsReady ? (
            <Button
              className="ml-auto h-5 px-2 text-[10px]"
              disabled={readiness.isLoggingIn}
              onClick={readiness.loginThreads}
              size="sm"
              type="button"
              variant="outline"
            >
              {readiness.isLoggingIn ? (
                <LoaderCircle className="size-2.5 animate-spin" />
              ) : (
                <LogIn className="size-2.5" />
              )}
              Đăng nhập
            </Button>
          ) : null}
        </CardContent>
        <CardContent className="pb-1.5 pt-0 px-3">
          <div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/[0.02] to-accent/20 p-3 shadow-xs transition-all hover:border-primary/30 sm:flex-row sm:items-center sm:gap-3.5">
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <div className="flex items-center gap-1 shrink-0">
                <KeyRound className="size-3.5 text-primary" />
                <span className="text-[11px] font-semibold text-foreground">License key:</span>
              </div>
              <Input
                className="h-7.5 min-w-0 flex-1 border-primary/20 bg-background/90 text-[11px] shadow-2xs focus-visible:ring-primary/30"
                onChange={(event) => setLicenseKey(event.target.value)}
                placeholder={
                  config?.license.configured
                    ? config.license.keyPreview || "Nhập license key"
                    : "Nhập license key"
                }
                type="password"
                value={licenseKey}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 ml-auto">
              <Button
                className="h-7.5 shrink-0 bg-primary px-3.5 text-[11px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
                disabled={saveLicenseMutation.isPending || !licenseKey.trim()}
                onClick={() =>
                  saveLicenseMutation.mutate({
                    ...(licenseKey.trim() ? { licenseKey: licenseKey.trim() } : {}),
                  })
                }
                size="sm"
                type="button"
              >
                {saveLicenseMutation.isPending ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  "Lưu"
                )}
              </Button>
              <Button
                className="h-7.5 shrink-0 px-2.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                disabled={
                  saveLicenseMutation.isPending || !Boolean(config?.license.configured)
                }
                onClick={() =>
                  saveLicenseMutation.mutate({
                    licenseKey: "",
                  })
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                Xóa
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/70 shadow-none" size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <input
            accept=".zip,application/zip"
            className="hidden"
            onChange={handleImportPortableUpdate}
            ref={portableUpdateInputRef}
            type="file"
          />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-foreground">Cập nhật Tool</p>
            <p className="text-[10px] text-muted-foreground">
              {portableUpdateQuery.data?.portable
                ? `Bản hiện tại: ${portableUpdateQuery.data.currentVersion}. Import ZIP mới, Tool sẽ tự đóng, cập nhật rồi mở lại.`
                : "Chỉ dùng được trong bản portable Windows/macOS."}
            </p>
            {updateMessage ? (
              <p className="mt-1 text-[10px] text-muted-foreground">{updateMessage}</p>
            ) : null}
          </div>
          <Button
            className="h-7.5 shrink-0 px-3 text-[11px]"
            disabled={
              !portableUpdateQuery.data?.portable ||
              importPortableUpdateMutation.isPending
            }
            onClick={handleImportPortableUpdateClick}
            size="sm"
            type="button"
            variant="outline"
          >
            {importPortableUpdateMutation.isPending ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            Import bản mới (.zip)
          </Button>
        </CardContent>
      </Card>

      <Card className="border border-border/70 shadow-none" size="sm">
        <CardContent className="space-y-1 px-3 py-1">
          <input
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportAbbreviationsFile}
            ref={abbreviationImportInputRef}
            type="file"
          />
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div
              className="min-w-0 truncate text-[12px] text-muted-foreground"
              title="CSV: key,value hoặc viết tắt,đọc thành"
            >
              <span className="font-medium text-foreground">Từ Điển Viết Tắt</span>
              <span className="mx-2 text-muted-foreground/60">•</span>
              <span>{Object.keys(abbreviationsQuery.data?.abbreviations ?? {}).length} từ</span>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                disabled={
                  importAbbreviationsMutation.isPending ||
                  importAbbreviationsFromUrlMutation.isPending ||
                  abbreviationsQuery.isLoading
                }
                onClick={handleExportAbbreviations}
                size="sm"
                type="button"
                variant="outline"
                className="h-6 px-2 text-[10px]"
              >
                <Download className="size-3" />
                Export CSV
              </Button>
              <Button
                disabled={
                  importAbbreviationsMutation.isPending ||
                  importAbbreviationsFromUrlMutation.isPending
                }
                onClick={handleImportAbbreviationsClick}
                size="sm"
                type="button"
                variant="outline"
                className="h-6 px-2 text-[10px]"
              >
                {importAbbreviationsMutation.isPending ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <Upload className="size-3" />
                )}
                Import CSV
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row">
            <Input
              className="h-6.5 text-[11px]"
              onChange={(event) => setAbbreviationSheetUrl(event.target.value)}
              placeholder="Dán link Sheet/CSV online 2 cột"
              type="url"
              value={abbreviationSheetUrl}
            />
            <Button
              className="h-6.5 shrink-0 px-2.5 text-[10px]"
              disabled={
                importAbbreviationsMutation.isPending ||
                importAbbreviationsFromUrlMutation.isPending ||
                !abbreviationSheetUrl.trim()
              }
              onClick={handleImportAbbreviationsFromUrl}
              size="sm"
              type="button"
              variant="outline"
            >
              {importAbbreviationsFromUrlMutation.isPending ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Upload className="size-3" />
              )}
              Import Sheet Online
            </Button>
          </div>
          {abbreviationImportMessage ? (
            <p className="text-[9px] leading-tight text-muted-foreground">{abbreviationImportMessage}</p>
          ) : null}
        </CardContent>
      </Card>

      <div
        className="grid grid-cols-2 gap-2"
      >
        <CredentialCard
          configured={Boolean(config?.credentials.ausynclabApiKeyConfigured)}
          description="Dán key rồi bấm Lưu và Kiểm tra."
          inputId="ausynclab-api-key"
          inputValue={ausynclabApiKey}
          label="AuSyncLab"
          onChange={setAusynclabApiKey}
          onClear={() => handleClearCredential("ausynclab")}
          onSave={() => handleSaveCredential("ausynclab")}
          onTest={() => handleTestCredential("ausynclab")}
          placeholder="Nhập AuSyncLab API key"
          saving={saveCredentialsMutation.isPending && savingProvider === "ausynclab"}
          testing={
            testCredentialMutation.isPending &&
            testCredentialMutation.variables?.provider === "ausynclab"
          }
        />

        <CredentialCard
          configured={Boolean(config?.credentials.fptAiApiKeyConfigured)}
          description="Dán key rồi bấm Lưu và Kiểm tra."
          inputId="fpt-api-key"
          inputValue={fptAiApiKey}
          label="FPT Voice"
          onChange={setFptAiApiKey}
          onClear={() => handleClearCredential("fpt")}
          onSave={() => handleSaveCredential("fpt")}
          onTest={() => handleTestCredential("fpt")}
          placeholder="Nhập FPT API key"
          saving={saveCredentialsMutation.isPending && savingProvider === "fpt"}
          testing={
            testCredentialMutation.isPending &&
            testCredentialMutation.variables?.provider === "fpt"
          }
        />

        <CredentialCard
          configured={Boolean(config?.credentials.googleCloudApiKeyConfigured)}
          description="Chỉ cần 1 trong các nhà cung cấp là đủ làm video."
          inputId="google-api-key"
          inputValue={googleCloudApiKey}
          label="Google Voice"
          onChange={setGoogleCloudApiKey}
          onClear={() => handleClearCredential("google")}
          onSave={() => handleSaveCredential("google")}
          onTest={() => handleTestCredential("google")}
          placeholder="Nhập Google API key"
          saving={
            saveCredentialsMutation.isPending && savingProvider === "google"
          }
          testing={
            testCredentialMutation.isPending &&
            testCredentialMutation.variables?.provider === "google"
          }
        />

        <CredentialCard
          configured={Boolean(config?.credentials.openAiApiKeyConfigured)}
          description="Dùng cho bước LLM làm sạch Text trước TTS. 
Nếu thiếu key, video vẫn chạy bằng rules "
          inputId="openai-api-key"
          inputValue={openAiApiKey}
          label="Gemini Text"
          onChange={setOpenAiApiKey}
          onClear={() => handleClearCredential("openai")}
          onSave={() => handleSaveCredential("openai")}
          onTest={() => handleTestCredential("openai")}
          placeholder="Nhập Gemini API key"
          saving={saveCredentialsMutation.isPending && savingProvider === "openai"}
          testing={
            testCredentialMutation.isPending &&
            testCredentialMutation.variables?.provider === "openai"
          }
        />

        <CredentialCard
          configured={Boolean(config?.credentials.vivibeApiKeyConfigured)}
          description="Dán key ViVibe rồi bấm Lưu và Kiểm tra để lấy voice."
          inputId="vivibe-api-key"
          inputValue={vivibeApiKey}
          label="ViVibe"
          onChange={setVivibeApiKey}
          onClear={() => handleClearCredential("vivibe")}
          onSave={() => handleSaveCredential("vivibe")}
          onTest={() => handleTestCredential("vivibe")}
          placeholder="Nhập ViVibe API key"
          saving={saveCredentialsMutation.isPending && savingProvider === "vivibe"}
          testing={
            testCredentialMutation.isPending &&
            testCredentialMutation.variables?.provider === "vivibe"
          }
        />
      </div>
    </div>
  );
};

const CredentialCard = ({
  configured,
  description,
  inputId,
  inputValue,
  label,
  onChange,
  onClear,
  onSave,
  onTest,
  placeholder,
  saving,
  testing,
}: {
  configured: boolean;
  description?: string;
  inputId: string;
  inputValue: string;
  label: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSave: () => void;
  onTest: () => void;
  placeholder: string;
  saving: boolean;
  testing: boolean;
}) => (
  <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-accent/30">
    {description ? null : null}
    <div className="flex items-center gap-1.5">
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10">
        <KeyRound className="size-2.5 text-primary" />
      </div>
      <label className="font-semibold text-[12px] text-foreground" htmlFor={inputId}>
        {label}
      </label>
      <Badge variant={configured ? "default" : "secondary"} className="h-3.5 rounded px-1 text-[8px] font-medium">
        {configured ? "Đã cấu hình" : "Chưa có key"}
      </Badge>
    </div>
    <div className="flex items-center gap-1">
      <Input
        className="h-7 min-w-0 flex-1 rounded-md text-[11px]"
        id={inputId}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="password"
        value={inputValue}
      />
      <Button
        className="h-7 shrink-0 rounded-md px-2 text-[11px]"
        disabled={saving || !inputValue.trim()}
        onClick={onSave}
        size="sm"
        type="button"
      >
        {saving ? <LoaderCircle className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
        Lưu
      </Button>
      <Button
        className="h-7 shrink-0 rounded-md px-2 text-[11px]"
        disabled={testing || (!configured && !inputValue.trim())}
        onClick={onTest}
        size="sm"
        type="button"
        variant="secondary"
      >
        {testing ? <LoaderCircle className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
        Kiểm tra
      </Button>
      <Button
        className="h-7 shrink-0 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        disabled={saving || !configured}
        onClick={onClear}
        size="sm"
        type="button"
        variant="ghost"
        title="Xóa"
      >
        Xóa
      </Button>
    </div>
  </div>
);

const CompactStatusChip = ({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) => (
  <div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/80 px-2 py-0.5">
    {ok ? (
      <CheckCircle2 className="size-2.5 text-emerald-600" />
    ) : (
      <CircleAlert className="size-2.5 text-amber-600" />
    )}
    <span className="text-[10px] text-muted-foreground">{label}:</span>
    <span className="text-[10px] font-medium">{value}</span>
  </div>
);

function parseImportedAbbreviationCsv(content: string): Record<string, string> {
  const rows = parseDelimitedRows(String(content ?? "").replace(/^\uFEFF/, ""));
  if (rows.length === 0) {
    return {};
  }

  const header = rows[0]?.map((cell) => normalizeCsvHeader(cell)) ?? [];
  const keyIndex = findHeaderIndex(header, ["key", "viettat", "abbreviation"]);
  const valueIndex = findHeaderIndex(header, [
    "value",
    "docthanh",
    "expansion",
    "meaning",
  ]);
  const hasMappedHeader = keyIndex >= 0 && valueIndex >= 0;
  const dataRows = hasMappedHeader
    ? rows.slice(1).map((row) => [row[keyIndex] ?? "", row[valueIndex] ?? ""])
    : rows;

  return Object.fromEntries(
    dataRows
      .map((row) => [
        String(row[0] ?? "").trim().toLowerCase(),
        String(row[1] ?? "").trim(),
      ] as const)
      .filter(([key, value]) => key && value)
  );
}

function parseCsvRows(content: string): string[][] {
  return parseRowsByDelimiter(content, ",");
}

function parseTsvRows(content: string): string[][] {
  return parseRowsByDelimiter(content, "\t");
}

function parseDelimitedRows(content: string): string[][] {
  const csvRows = parseCsvRows(content);
  const tsvRows = parseTsvRows(content);
  const csvScore = scoreDelimitedRows(csvRows);
  const tsvScore = scoreDelimitedRows(tsvRows);
  return tsvScore > csvScore ? tsvRows : csvRows;
}

function parseRowsByDelimiter(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((item) => item.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((item) => item.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function scoreDelimitedRows(rows: string[][]): number {
  return rows.reduce((score, row) => score + (row.length >= 2 ? row.length : 0), 0);
}

function normalizeCsvHeader(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function findHeaderIndex(headers: string[], acceptedHeaders: string[]): number {
  return headers.findIndex((header) => acceptedHeaders.includes(header));
}

function serializeAbbreviationCsv(abbreviations: Record<string, string>): string {
  const rows = [
    ["key", "value"],
    ...Object.entries(abbreviations)
      .filter(([key, value]) => String(key).trim() && String(value).trim())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value]),
  ];
  return `${rows.map((row) => row.map(escapeCsvField).join(",")).join("\n")}\n`;
}

function escapeCsvField(value: string): string {
  const normalized = String(value ?? "");
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function withUtf8Bom(value: string): string {
  return value.startsWith("\uFEFF") ? value : `\uFEFF${value}`;
}
