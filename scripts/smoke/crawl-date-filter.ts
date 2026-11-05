import {
  buildPublishTimeMetadata,
  resolveRequestedDateRange,
} from "../../apps/server/src/modules/crawl/utils/date-range";

const bangkokSingleDay = buildPublishTimeMetadata({
  createdAt: "2026-07-10T18:30:00.000Z",
  dateRange: {
    end_date: "2026-07-11",
    preset: "",
    start_date: "2026-07-11",
    timezone: "Asia/Bangkok",
  },
  referenceTime: "2026-07-11T05:00:00.000Z",
  source: "threads_time_datetime",
});

if (!bangkokSingleDay.passed_date_filter || bangkokSingleDay.date_key !== "2026-07-11") {
  throw new Error(`Expected Bangkok local date 2026-07-11 to pass, got ${JSON.stringify(bangkokSingleDay)}.`);
}

const utcSingleDay = buildPublishTimeMetadata({
  createdAt: "2026-07-10T18:30:00.000Z",
  dateRange: {
    end_date: "2026-07-11",
    preset: "",
    start_date: "2026-07-11",
    timezone: "UTC",
  },
});
if (utcSingleDay.passed_date_filter || utcSingleDay.filter_reason !== "date_before_start") {
  throw new Error("Expected the same timestamp to fall before 2026-07-11 in UTC.");
}

for (const createdAt of ["2026-07-01T00:00:00+07:00", "2026-07-15T23:59:59+07:00"]) {
  const result = buildPublishTimeMetadata({
    createdAt,
    dateRange: {
      end_date: "2026-07-15",
      preset: "",
      start_date: "2026-07-01",
      timezone: "Asia/Bangkok",
    },
  });
  if (!result.passed_date_filter) throw new Error(`Expected inclusive boundary ${createdAt} to pass.`);
}

const future = buildPublishTimeMetadata({
  createdAt: "2026-07-11T12:00:00+07:00",
  dateRange: {
    end_date: "2030-01-02",
    preset: "",
    start_date: "2030-01-01",
    timezone: "Asia/Bangkok",
  },
});
if (future.filter_reason !== "date_before_start") {
  throw new Error("Expected a current post to be rejected by a future range.");
}

const oldRange = buildPublishTimeMetadata({
  createdAt: "2026-07-11T12:00:00+07:00",
  dateRange: {
    end_date: "2020-01-31",
    preset: "",
    start_date: "2020-01-01",
    timezone: "Asia/Bangkok",
  },
});
if (oldRange.filter_reason !== "date_after_end") {
  throw new Error("Expected a current post to be rejected by an old range.");
}

const reversed = resolveRequestedDateRange({
  endValue: "2026-07-01",
  startValue: "2026-07-15",
  timezone: "Asia/Bangkok",
});
if (reversed.startDate !== "2026-07-01" || reversed.endDate !== "2026-07-15") {
  throw new Error(`Expected reversed range to normalize safely, got ${JSON.stringify(reversed)}.`);
}

console.log("smoke:crawl-date-filter ok");
