import { ChevronDown, ChevronRight, LoaderCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NumberField,
  SelectField,
  TextareaField,
  TextField,
} from "./form-controls";
import {
  datePresetOptions,
  sourceModeOptions,
  type CrawlFormState,
  type UpdateCrawlForm,
} from "./form-state";
import { CrawlAdvancedOptions } from "./crawl-advanced-options";
import { classifySeedTarget } from "./payload";

export const CrawlForm = ({
  canStart,
  errorMessage,
  form,
  isPending,
  isRunning,
  onSubmit,
  startBlockedReason,
  updateForm,
  queuedAheadCount = 0,
}: {
  canStart: boolean;
  errorMessage?: string;
  form: CrawlFormState;
  isPending: boolean;
  isRunning: boolean;
  onSubmit: () => void;
  startBlockedReason?: string;
  updateForm: UpdateCrawlForm;
  queuedAheadCount?: number;
}) => {
  const handleDatePresetChange = (value: string) => {
    updateForm("datePreset", value);
    if (
      value === "none" ||
      value === "today" ||
      value === "last_7_days" ||
      value === "last_30_days"
    ) {
      updateForm("startDate", "");
      updateForm("endDate", "");
    } else if (value === "after_date") {
      updateForm("endDate", "");
    } else if (value === "before_date") {
      updateForm("startDate", "");
    }
  };

  const showAdvanced = form.advancedEnabled;
  const showSearchQueries = form.sourceMode !== "seed_only";
  const showSeedUrls = form.sourceMode !== "discover";
  const isSeedOnlyMode = form.sourceMode === "seed_only";
  const showDateFilter = !isSeedOnlyMode;
  const hasProfileSeed = form.seedPostUrls
    .split(/[\n,]+/)
    .some((value) => classifySeedTarget(value.trim()) === "profile");
  const showWantedPosts = !isSeedOnlyMode || hasProfileSeed;
  const showAfterDate = form.datePreset === "after_date";
  const showBeforeDate = form.datePreset === "before_date";
  const showDateRange = form.datePreset === "date_range";

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="relative">
        <TextField
          label={isSeedOnlyMode ? "Tên file muốn lưu" : "Chủ đề"}
          onChange={(value) => updateForm("topicTitle", value)}
          placeholder={
            isSeedOnlyMode
              ? "Ví dụ: hanie seed test"
              : "Ví dụ: Bóng đá, Tiết kiệm tiền, Skincare giá rẻ"
          }
          value={form.topicTitle}
        />
        <button
          type="button"
          onClick={() => {
            updateForm("topicTitle", "");
            updateForm("searchQueries", "");
            updateForm("seedPostUrls", "");
            updateForm("trendSearchUrls", "");
            updateForm("wantedPosts", 5);
            updateForm("datePreset", "none");
            updateForm("startDate", "");
            updateForm("endDate", "");
            updateForm("topCommentsPerPost", 5);
          }}
          className="absolute right-0 top-0 text-[11px] font-large text-muted-foreground transition-colors hover:text-foreground"
        >
          Reset các ô input
        </button>
      </div>

      <p className="-mt-2 text-[11px] text-muted-foreground">
        {isSeedOnlyMode
          ? "Ô này dùng để đặt tên file muốn lưu."
          : "Ghi ngắn gọn chủ đề cần tìm. Sẽ dùng để đặt tên file đầu ra."}
      </p>

      <SelectField
        label="Cách lấy bài viết"
        onChange={(value) => {
          const nextMode = value as CrawlFormState["sourceMode"];
          updateForm("sourceMode", nextMode);
          if (nextMode === "seed_only") {
            updateForm("datePreset", "none");
            updateForm("startDate", "");
            updateForm("endDate", "");
          }
        }}
        options={sourceModeOptions}
        value={form.sourceMode}
      />

      {showSearchQueries ? (
        <>
          <TextareaField
            label="Từ khóa hỗ trợ tìm kiếm"
            onChange={(value) => updateForm("searchQueries", value)}
            placeholder={"Ví dụ:\nworld cup\nbóng đá\ncầu thủ\nđội tuyển"}
            rows={4}
            value={form.searchQueries}
          />
          <p className="-mt-2 text-[11px] text-muted-foreground">
            Không bắt buộc. Giúp hệ thống tìm bài chính xác hơn. Các từ này
            không bắt buộc phải xuất hiện nguyên vẹn trong bài viết. Nếu cần lọc
            cứng theo đúng cụm từ, mở Bộ lọc nâng cao.
          </p>
          <TextareaField
            label="Link trend search Threads"
            onChange={(value) => updateForm("trendSearchUrls", value)}
            placeholder={
              "Mỗi dòng 1 link trend search.\nVí dụ:\nhttps://www.threads.com/search?q=Ha%20An%20Huy&serp_type=trends&trend_fbid=1413677120519264"
            }
            rows={3}
            value={form.trendSearchUrls}
          />
          <p className="-mt-2 text-[11px] text-muted-foreground">
            Không bắt buộc. Hệ thống sẽ mở trực tiếp URL trend này thay vì gõ lại
            từ khóa, phù hợp khi bạn thấy Threads đang gom một chủ đề thành trend.
          </p>
        </>
      ) : null}

      {showSeedUrls ? (
        <div className="grid gap-1.5">
          <TextareaField
            label="Link / mã nhúng bài viết cần crawl"
            onChange={(value) => updateForm("seedPostUrls", value)}
            placeholder={
              "Mỗi dòng 1 link Threads hoặc dán nguyên mã nhúng.\nVí dụ: https://www.threads.com/@user/post/ABC123?xmt=...\nHoặc: https://www.threads.com/share/F2G13cPhn/"
            }
            rows={3}
            value={form.seedPostUrls}
          />
          <p className="text-[11px] text-muted-foreground">
            Hỗ trợ link bài viết, link /share, link /t, link hồ sơ và mã nhúng Threads.
          </p>
        </div>
      ) : null}

      {showWantedPosts ? (
        <div className={showDateFilter ? "grid grid-cols-2 gap-3" : undefined}>
          <NumberField
            label="Số lượng bài cần lấy"
            min={1}
            onChange={(value) => updateForm("wantedPosts", value)}
            value={form.wantedPosts}
          />
          {showDateFilter ? (
            <SelectField
            label="Ngày đăng"
            onChange={handleDatePresetChange}
            options={datePresetOptions}
            value={form.datePreset || "none"}
          />
          ) : null}
        </div>
      ) : (
        <>
          {showDateFilter ? (
          <SelectField
            label="Ngày đăng"
            onChange={handleDatePresetChange}
            options={datePresetOptions}
            value={form.datePreset || "none"}
          />
          ) : null}
          <NumberField
            label="Top comment muốn lấy"
            min={0}
            onChange={(value) => updateForm("topCommentsPerPost", value)}
            value={form.topCommentsPerPost}
          />
        </>
      )}

      {showDateFilter && showAfterDate ? (
        <TextField
          description="Chỉ lấy bài đăng từ ngày này trở đi"
          label="Sau ngày"
          onChange={(value) => {
            updateForm("startDate", value);
            updateForm("endDate", "");
          }}
          type="date"
          value={form.startDate}
        />
      ) : null}

      {showDateFilter && showBeforeDate ? (
        <TextField
          description="Chỉ lấy bài đăng trước hoặc đúng ngày này"
          label="Trước ngày"
          onChange={(value) => {
            updateForm("endDate", value);
            updateForm("startDate", "");
          }}
          type="date"
          value={form.endDate}
        />
      ) : null}

      {showDateFilter && showDateRange ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            description="Chọn ngày bắt đầu"
            label="Từ ngày"
            max={form.endDate || undefined}
            onChange={(value) => updateForm("startDate", value)}
            type="date"
            value={form.startDate}
          />
          <TextField
            description="Chọn ngày kết thúc"
            label="Đến ngày"
            min={form.startDate || undefined}
            onChange={(value) => updateForm("endDate", value)}
            type="date"
            value={form.endDate}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => updateForm("advancedEnabled", !form.advancedEnabled)}
          type="button"
        >
          {showAdvanced ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {isSeedOnlyMode ? "Tùy chọn thêm" : "Bộ lọc nâng cao"}
        </button>
        <Button disabled={!canStart} size="sm" type="submit">
          {isPending ? (
            <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <Play className="mr-1.5 size-3.5" />
          )}
          {isRunning
            ? `Thêm vào hàng chờ${queuedAheadCount > 0 ? ` (${queuedAheadCount})` : ""}`
            : "Bắt đầu crawl"}
        </Button>
      </div>

      {isRunning ? (
        <p className="text-[11px] text-muted-foreground">
          {queuedAheadCount > 0
            ? `Phiên mới sẽ xếp sau ${queuedAheadCount} phiên đang chạy/chờ. Crawl không chạy song song.`
            : "Phiên mới sẽ được đưa vào hàng chờ. Crawl không chạy song song."}
        </p>
      ) : null}

      {startBlockedReason ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {startBlockedReason}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {showAdvanced ? (
        <CrawlAdvancedOptions
          form={form}
          mode={form.sourceMode}
          updateForm={updateForm}
        />
      ) : null}
    </form>
  );
};
