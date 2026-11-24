"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, Legend, LineChart, Line, CartesianGrid, AreaChart, Area, ReferenceLine,
} from "recharts";
import {
  KeyRound, TrendingUp, TrendingDown, Users, CalendarClock, Droplet, Timer, ShieldCheck,
  XCircle, Wrench, Smile, MessageSquareWarning, LayoutDashboard, CalendarDays, Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  SERVICE_POINTS as DEFAULT_POINTS, TAT_STAGES, TAT_STAGE_META, withPmGroups, withKpiIndicatorConfig,
  MONTH_NAMES_TH, MONTH_ABBR_TH, fiscalYearMonths, fiscalYearMonthsFilled,
} from "@/lib/constants";
import type { PmMachine } from "@/lib/sheets-pm-machines";
import type { ServicePointRow } from "@/lib/sheets-service-points";
import type { KpiIndicatorConfigRow } from "@/lib/sheets-kpi-indicators";
import { pointMeta } from "@/lib/point-meta";
import {
  RecordRow, availableFiscalYears, fiscalMonthLabels, yearlyTrend,
} from "@/lib/aggregate";
import {
  type PeriodType, type RangeKey, yearMonths, availableYears, rangeIndices, rangeOptions, periodLabel,
  filterRecords, pointMonthly, typeTotals, sameMonthsLastYear,
} from "@/lib/service-filter";
import type { PatientCategoryKey } from "@/lib/patient-categories";
import { CategoryPicker } from "@/components/CategoryPicker";
import {
  TatRecordRow, availableTatYears, tatSeriesByPoint, tatMonthLabels, tatByPointForMonth,
} from "@/lib/aggregate-tat";
import {
  KpiRecordRow, kpiMonthResult, kpiYearTrend, kpiStatus, availableKpiYears, ratioPairCountTrend,
} from "@/lib/aggregate-kpi";
import { CountUp } from "@/components/CountUp";
import { BentoCard } from "@/components/BentoCard";
import { StatusBanner } from "@/components/StatusBanner";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { LiveClock } from "@/components/LiveClock";
import { ExecutiveSummary } from "@/components/ExecutiveSummary";
import { SectionNav, type SectionNavItem } from "@/components/SectionNav";
import { ComplaintCountChart, type ComplaintCountRow } from "@/components/ComplaintCountChart";
import { PatientCategoryCard } from "@/components/PatientCategoryCard";
import { linearForecastNextYear } from "@/lib/forecast";
import { useTheme } from "@/lib/useTheme";

// Ranked horizontal bar list — replaces the old per-point pie/donut for
// "share by ประเภทผู้รับบริการ". A pie's slice labels collide once there
// are 4+ categories with long Thai names; a bar list has room for the full
// label, the raw count, and the % side by side, with no overlap risk.
function TypeBreakdownBars({
  data, palette,
}: { data: { type: string; total: number }[]; palette: string[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const pct = total > 0 ? (d.total / total) * 100 : 0;
        const widthPct = (d.total / max) * 100;
        const color = palette[i % palette.length];
        return (
          <div key={d.type} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="truncate text-xs text-base-content/60" title={d.type}>{d.type}</span>
            </div>
            <div className="stat-figure-num w-14 shrink-0 text-right text-xs text-base-content/70">
              {d.total.toLocaleString()}
            </div>
            <div className="w-10 shrink-0 text-right text-[11px] font-semibold" style={{ color }}>
              {pct.toFixed(0)}%
            </div>
            <div className="col-span-3 h-1.5 overflow-hidden rounded-full bg-base-content/6">
              <div
                className="h-full rounded-full transition-[width]"
                style={{ width: `${widthPct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Decorative icon + a fixed categorical accent per quality indicator — never
// a status color (success/error already carry the PASS/FAIL meaning on the
// badge next to it, so this stays purely identity, not state).
const KPI_ICON_META: Record<string, LucideIcon> = {
  rejection: XCircle,
  pm: Wrench,
  tat30: Timer,
  satisfaction: Smile,
  complaint: MessageSquareWarning,
  safety: ShieldCheck,
};
const KPI_ACCENTS = [
  "var(--color-primary)",
  "var(--color-secondary)",
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-primary)",
  "var(--color-secondary)",
];

// A shared 0–100 y-axis reads consistently across cards, but it also
// flattens any indicator whose real values and target both sit near one end
// of that range (e.g. rejection rate ≤0.5%, or PM/complaint/TAT30/satisfaction
// clustered near their 90–100% target) into what looks like a flat line —
// the variance that actually matters is too small a fraction of 100 to see.
// Zooming the axis to the data + target (with a dashed target reference line
// so the threshold stays visible) keeps the chart honest while making real
// month-to-month movement legible.
function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function zoomedPercentAxis(values: (number | null | undefined)[], target?: number) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return { domain: [0, 100] as [number, number], ticks: undefined, targetInRange: false };
  const dataMin = Math.min(...nums);
  const dataMax = Math.max(...nums);
  const dataSpan = Math.max(dataMax - dataMin, dataMax * 0.1, 1);

  // Fold the target into the zoomed range only if it's reasonably close to
  // the real data (within ~2x the data's own spread). A target far outside
  // the actual variance — satisfaction's 30% floor when real scores run
  // 75-85%, say — would otherwise blow the zoom back out to the same wide,
  // flat-looking range this is meant to fix. When that happens the target
  // is shown as a badge next to the chart title instead of a line on it.
  let lo = dataMin;
  let hi = dataMax;
  let targetInRange = target == null;
  if (target != null) {
    const distOutside = target < dataMin ? dataMin - target : target > dataMax ? target - dataMax : 0;
    if (distOutside <= dataSpan * 2) {
      lo = Math.min(lo, target);
      hi = Math.max(hi, target);
      targetInRange = true;
    }
  }

  const span = Math.max(hi - lo, hi * 0.1, 1);
  const step = niceStep(span / 4);
  const loF = Math.max(0, Math.floor((lo - span * 0.25) / step) * step);
  let hiF = Math.min(100, Math.ceil((hi + span * 0.25) / step) * step);
  if (hiF <= loF) hiF = Math.min(100, loF + step);
  const ticks: number[] = [];
  for (let v = loF; v <= hiF + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { domain: [loF, hiF] as [number, number], ticks, targetInRange };
}

type TrendPoint = { year: number; total: number; complete: boolean };

/** Splits yearly totals into a solid "total" series (complete fiscal years)
 * and a dashed "partialTotal" series for a year still in progress. The
 * partial series also carries the previous complete year's value so the
 * dashed segment starts exactly where the solid line ends. */
function withPartialSeries(rows: TrendPoint[]) {
  const out = rows.map((t) => ({
    year: t.year,
    total: t.complete ? t.total : (null as number | null),
    partialTotal: t.complete ? (null as number | null) : t.total,
  }));
  out.forEach((r, i) => {
    if (r.partialTotal != null && i > 0 && out[i - 1].total != null) {
      out[i - 1].partialTotal = out[i - 1].total;
    }
  });
  return out;
}

/** "ต.ค." / "ต.ค.–ธ.ค." for the months a like-for-like YoY compared. */
function comparedMonthsLabel(months: number[]): string {
  if (months.length === 0) return "";
  const abbr = (m: number) => MONTH_ABBR_TH[m - 1];
  return months.length === 1 ? abbr(months[0]) : `${abbr(months[0])}–${abbr(months[months.length - 1])}`;
}

/** A small caption above one filter control. */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-base-content/45">{label}</span>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton h-36 rounded-box bg-base-200/60" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { mode } = useTheme();
  const isLight = mode === "light";
  // Recharts needs plain color strings (not CSS vars) for tooltip/axis/grid,
  // so the dark/light pair lives here instead of in globals.css.
  const chartColors = useMemo(
    () => ({
      tooltip: {
        background: isLight ? "#FFFFFF" : "#0F1524",
        border: isLight ? "1px solid rgba(15,21,36,0.08)" : "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        fontSize: 12,
        color: isLight ? "#1A2033" : "#E7EAF3",
      },
      axisTick: isLight ? "#64748B" : "#8C98B8",
      grid: isLight ? "rgba(15,21,36,0.09)" : "rgba(255,255,255,0.06)",
      cursor: isLight ? "rgba(15,21,36,0.05)" : "rgba(255,255,255,0.04)",
    }),
    [isLight]
  );

  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Fiscal year: drives the ผู้รับบริการ section in "ปีงบประมาณ" mode AND the
  // per-indicator KPI trend charts further down (which are fiscal-only).
  const [fiscalYear, setFiscalYear] = useState<number | null>(null);
  // ผู้รับบริการ-section filters (lib/service-filter.ts). They only affect
  // that section; TAT and the quality indicators keep their own selectors.
  const [periodType, setPeriodType] = useState<PeriodType>("fiscal");
  const [calYear, setCalYear] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const [customFrom, setCustomFrom] = useState(0);
  const [customTo, setCustomTo] = useState(11);
  const [pointFilter, setPointFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<PatientCategoryKey[] | "all">("all");
  const [showYoY, setShowYoY] = useState(true);

  const [tatRecords, setTatRecords] = useState<TatRecordRow[]>([]);
  const [tatYear, setTatYear] = useState<number | null>(null);
  const [tatError, setTatError] = useState<string | null>(null);

  const [kpiRecords, setKpiRecords] = useState<KpiRecordRow[]>([]);
  const [kpiError, setKpiError] = useState<string | null>(null);

  const [pmMachines, setPmMachines] = useState<PmMachine[]>([]);
  const [servicePointRows, setServicePointRows] = useState<ServicePointRow[]>([]);
  const [kpiIndicatorConfig, setKpiIndicatorConfig] = useState<KpiIndicatorConfigRow[]>([]);

  useEffect(() => {
    fetch("/api/records")
      .then((r) => r.json())
      .then((data: { records?: RecordRow[]; error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setRecords(data.records ?? []);
        const years = availableFiscalYears(data.records ?? []);
        if (years.length) setFiscalYear(years[years.length - 1]);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));

    fetch("/api/tat")
      .then((r) => r.json())
      .then((data: { records?: TatRecordRow[]; error?: string }) => {
        if (data.error) { setTatError(data.error); return; }
        setTatRecords(data.records ?? []);
        const years = availableTatYears(data.records ?? []);
        if (years.length) setTatYear(years[years.length - 1]);
      })
      .catch((e) => setTatError(String(e)));

    fetch("/api/kpi")
      .then((r) => r.json())
      .then((data: { records?: KpiRecordRow[]; error?: string }) => {
        if (data.error) { setKpiError(data.error); return; }
        setKpiRecords(data.records ?? []);
      })
      .catch((e) => setKpiError(String(e)));

    fetch("/api/pm-machines")
      .then((r) => r.json())
      .then((data: { machines?: PmMachine[]; error?: string }) => {
        if (data.error) return;
        setPmMachines(data.machines ?? []);
      })
      .catch(() => {});

    fetch("/api/service-points")
      .then((r) => r.json())
      .then((data: { points?: ServicePointRow[]; error?: string }) => {
        if (data.error) return;
        setServicePointRows(data.points ?? []);
      })
      .catch(() => {});

    fetch("/api/kpi-indicators")
      .then((r) => r.json())
      .then((data: { config?: KpiIndicatorConfigRow[]; error?: string }) => {
        if (data.error) return;
        setKpiIndicatorConfig(data.config ?? []);
      })
      .catch(() => {});
  }, []);

  // Admin-managed จุดบริการ (lib/sheets-service-points.ts), active ones only
  // — same pattern as the PM machines below. Shared by both the attendance
  // and TAT charts/tables on this page.
  const SERVICE_POINTS = useMemo(
    () =>
      servicePointRows.length
        ? servicePointRows.filter((p) => p.active).map((p) => p.point)
        : [...DEFAULT_POINTS],
    [servicePointRows]
  );

  // Admin-managed PM machines (lib/sheets-pm-machines.ts), active ones only
  // — a retired machine drops off the live dashboard/trend calculations
  // immediately, though its past rows stay in the "ตัวชี้วัด" sheet untouched.
  const kpiIndicators = useMemo(() => {
    const base = withPmGroups(pmMachines.filter((m) => m.active).map((m) => ({ key: m.key, label: m.label })));
    return withKpiIndicatorConfig(base, kpiIndicatorConfig);
  }, [pmMachines, kpiIndicatorConfig]);

  const years = useMemo(() => availableFiscalYears(records), [records]);
  const monthLabels = fiscalMonthLabels();
  const trend = useMemo(() => yearlyTrend(records), [records]);
  const incompleteTrend = trend.find((t) => !t.complete) ?? null;

  // Simple linear forecast for next fiscal year's total, fit only on
  // fiscal years whose 12 months are all filled in — the live-computed
  // years and legacy ones alike. A year still in progress would understate
  // its eventual total and skew the slope downward if it were included.
  const forecast = useMemo(() => {
    const liveFiscalYears = new Set(availableFiscalYears(records));
    const completeRows = trend.filter(
      (t) => !liveFiscalYears.has(t.year) || fiscalYearMonthsFilled(records, t.year) >= 12
    );
    const next = linearForecastNextYear(completeRows.map((r) => ({ year: r.year, total: r.total })));
    if (!next) return null;
    // % change vs. the last fully-filled fiscal year — not necessarily
    // trend's last row, which may itself be a still-in-progress year with
    // a smaller year-to-date number that would make the comparison noise.
    const baseline = completeRows[completeRows.length - 1]?.total ?? null;
    const pctChange = baseline ? ((next.total - baseline) / baseline) * 100 : null;
    return { ...next, pctChange };
  }, [trend, records]);

  // ── ผู้รับบริการ section: apply the filters ──
  const calYears = useMemo(() => availableYears(records, "calendar"), [records]);
  const svcYears = periodType === "fiscal" ? years : calYears;
  const svcYear = periodType === "fiscal" ? fiscalYear : (calYear ?? calYears[calYears.length - 1] ?? null);
  // The 12 months of the chosen fiscal/calendar year, in display order.
  const months12 = useMemo(() => (svcYear != null ? yearMonths(periodType, svcYear) : []), [periodType, svcYear]);
  // Which of those 12 the ช่วงเวลา filter selects.
  const selIdx = useMemo(() => rangeIndices(range, customFrom, customTo), [range, customFrom, customTo]);
  const selMonths = useMemo(() => selIdx.map((i) => months12[i]).filter((m) => m != null), [selIdx, months12]);
  const isSelected = (i: number) => range === "all" || selIdx.includes(i);
  // Point + category filtered rows (everything in this section reads these).
  const svcRecords = useMemo(
    () => filterRecords(records, pointFilter, categoryFilter),
    [records, pointFilter, categoryFilter]
  );
  // Point-filtered only: the base for the ประเภท card's "% of all patients".
  const pointRecords = useMemo(() => filterRecords(records, pointFilter, "all"), [records, pointFilter]);
  const shownPoints = useMemo(
    () => (pointFilter === "all" ? SERVICE_POINTS : [pointFilter]),
    [pointFilter, SERVICE_POINTS]
  );
  const pointSeries = useMemo(() => pointMonthly(svcRecords, months12, shownPoints), [svcRecords, months12, shownPoints]);
  const displayByPoint = pointSeries.map((p) => ({
    point: p.point,
    total: selIdx.reduce((s, i) => s + (p.values[i] ?? 0), 0),
  }));
  const grandTotal = displayByPoint.reduce((s, p) => s + p.total, 0);
  const filterSuffix = [
    pointFilter !== "all" ? pointFilter : null,
    categoryFilter !== "all" ? `${categoryFilter.length} ประเภท` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const yearLabel = periodType === "fiscal" ? `ปีงบ ${svcYear}` : `ปีปฏิทิน ${svcYear}`;
  const scopeLabel =
    (svcYear != null ? periodLabel(periodType, svcYear, range, customFrom, customTo) : "") +
    (filterSuffix ? ` · ${filterSuffix}` : "");
  // Same months one year earlier, only months entered in both years.
  const heroChange = useMemo(() => sameMonthsLastYear(svcRecords, records, selMonths), [svcRecords, records, selMonths]);
  const filtersActive =
    periodType !== "fiscal" || range !== "all" || pointFilter !== "all" || categoryFilter !== "all";
  function resetFilters() {
    setPeriodType("fiscal");
    setRange("all");
    setCustomFrom(0);
    setCustomTo(11);
    setPointFilter("all");
    setCategoryFilter("all");
  }

  const monthlyChartData = months12.map((m, i) => {
    const row: Record<string, string | number> = { month: m.label };
    for (const p of pointSeries) row[p.point] = p.values[i];
    return row;
  });

  // A fiscal year still in progress only has its year-to-date total, so it
  // is drawn as a separate dashed "partialTotal" segment (bridged from the
  // previous complete year) instead of extending the solid line — otherwise
  // every October the line plunges as if service volume collapsed.
  const sparklineData = useMemo(() => withPartialSeries(trend.slice(-6)), [trend]);
  // The forecast line is a second series so it can be dashed and colored
  // differently from the actual-totals line: "forecastTotal" is null for
  // every real year except the last one (so the dashed segment starts
  // exactly where the solid line ends) plus the forecast year itself.
  const trendChartData = useMemo(() => {
    const rows: { year: string; total: number | null; partialTotal: number | null; forecastTotal: number | null }[] =
      withPartialSeries(trend).map((r) => ({ ...r, year: String(r.year), forecastTotal: null }));
    if (forecast) {
      const bridgeIdx = rows.findIndex((r) => r.year === String(forecast.year - 1));
      if (bridgeIdx >= 0) rows[bridgeIdx].forecastTotal = rows[bridgeIdx].total;
      const existingIdx = rows.findIndex((r) => r.year === String(forecast.year));
      if (existingIdx >= 0) {
        rows[existingIdx].forecastTotal = forecast.total;
      } else {
        rows.push({ year: String(forecast.year), total: null, partialTotal: null, forecastTotal: forecast.total });
      }
    }
    return rows;
  }, [trend, forecast]);

  const tatYears = useMemo(() => availableTatYears(tatRecords), [tatRecords]);
  const tatMonths = tatMonthLabels();
  const tatChartDataByPoint = useMemo(() => {
    if (!tatYear) return [];
    return SERVICE_POINTS.map((point) => {
      const series = tatSeriesByPoint(tatRecords, tatYear, point);
      const data = tatMonths.map((label, i) => {
        const row: Record<string, string | number | null> = { month: label };
        for (const s of series) row[s.stage] = s.values[i];
        return row;
      });
      return { point, data };
    });
  }, [tatRecords, tatYear, tatMonths, SERVICE_POINTS]);

  // Side-by-side point comparison: the latest month (within the selected
  // TAT year) that has any data at all, across every จุดบริการ at once —
  // the "all 4 points in one view" complement to the per-point trend
  // charts above, which only show one point's history at a time.
  const tatCompare = useMemo(() => {
    if (!tatYear) return { month: null as number | null, rows: [] as ReturnType<typeof tatByPointForMonth> };
    const monthsWithData = tatRecords.filter((r) => r.year === tatYear).map((r) => r.month);
    if (!monthsWithData.length) return { month: null, rows: [] };
    const month = Math.max(...monthsWithData);
    return { month, rows: tatByPointForMonth(tatRecords, tatYear, month, SERVICE_POINTS, TAT_STAGES) };
  }, [tatRecords, tatYear, SERVICE_POINTS]);

  // Fastest/slowest by the "รวมทั้งหมด" stage, to call out at a glance —
  // only meaningful once at least 2 points have that stage filled in.
  const tatCompareRanked = useMemo(() => {
    const totalStage = TAT_STAGES[3];
    const withTotal = tatCompare.rows
      .map((r) => ({ point: r.point as string, total: r[totalStage] as number | null }))
      .filter((r): r is { point: string; total: number } => r.total != null);
    if (withTotal.length < 2) return null;
    const sorted = [...withTotal].sort((a, b) => a.total - b.total);
    return { fastest: sorted[0], slowest: sorted[sorted.length - 1] };
  }, [tatCompare]);

  // Latest (year, month) that has any KPI row — the default the summary
  // opens on, before the person picks a different one with the selector.
  const kpiLatestMonth = useMemo(() => {
    if (!kpiRecords.length) return null;
    return kpiRecords.reduce(
      (latest, r) => {
        const key = r.year * 12 + r.month;
        return key > latest.key ? { key, year: r.year, month: r.month } : latest;
      },
      { key: -Infinity, year: 0, month: 0 }
    );
  }, [kpiRecords]);

  // Month/year picker for "สรุปภาพรวมตัวชี้วัดคุณภาพ" — null state means
  // "use the latest filled-in month" (computed below), so the picker opens
  // on the latest month without an effect needed to seed it; picking a
  // value from either select moves it out of that default and into an
  // explicit (ปีงบ, เดือน) selection.
  const kpiYears = useMemo(() => availableKpiYears(kpiRecords), [kpiRecords]);
  const [kpiYear, setKpiYear] = useState<number | null>(null);
  const [kpiMonthIdx, setKpiMonthIdx] = useState<number | null>(null);

  const kpiLatestFiscalYear = kpiLatestMonth
    ? kpiLatestMonth.month >= 10 ? kpiLatestMonth.year + 1 : kpiLatestMonth.year
    : null;
  const effectiveKpiYear = kpiYear ?? kpiLatestFiscalYear;
  const kpiMonthOptions = useMemo(
    () => (effectiveKpiYear != null ? fiscalYearMonths(effectiveKpiYear) : []),
    [effectiveKpiYear]
  );
  const effectiveKpiMonthIdx =
    kpiMonthIdx ??
    (kpiLatestMonth
      ? kpiMonthOptions.findIndex((m) => m.year === kpiLatestMonth.year && m.month === kpiLatestMonth.month)
      : -1);
  const kpiViewPair =
    effectiveKpiMonthIdx >= 0 ? kpiMonthOptions[effectiveKpiMonthIdx] ?? kpiLatestMonth : kpiLatestMonth;

  const kpiResults = useMemo(() => {
    if (!kpiViewPair) return [];
    return kpiIndicators.map((indicator) => ({
      indicator,
      result: kpiMonthResult(indicator, kpiRecords, records, kpiViewPair.year, kpiViewPair.month),
    }));
  }, [kpiRecords, records, kpiViewPair, kpiIndicators]);

  // The single most actionable thing a dashboard viewer wants surfaced
  // immediately: which quality indicators missed the viewed month's target.
  const failedKpis = useMemo(
    () => kpiResults.filter((r) => kpiStatus(r.indicator, r.result) === "fail"),
    [kpiResults]
  );

  // The (year, month) immediately before kpiViewPair, so the executive
  // summary can show a month-over-month trend arrow per indicator.
  const kpiPrevMonthPair = useMemo(() => {
    if (!kpiViewPair) return null;
    const month = kpiViewPair.month === 1 ? 12 : kpiViewPair.month - 1;
    const year = kpiViewPair.month === 1 ? kpiViewPair.year - 1 : kpiViewPair.year;
    return { year, month };
  }, [kpiViewPair]);

  // One-page-glance summary: PASS/FAIL per indicator (evaluated against its
  // own target, direction-aware) plus a trend arrow vs. last month.
  const executiveSummary = useMemo(() => {
    if (!kpiViewPair) return [];
    return kpiResults.map(({ indicator, result }) => {
      const prevResult = kpiPrevMonthPair
        ? kpiMonthResult(indicator, kpiRecords, records, kpiPrevMonthPair.year, kpiPrevMonthPair.month)
        : null;
      const status = kpiStatus(indicator, result);
      let trend: "up" | "down" | null = null;
      // Incidents carry a count instead of a %; compare whichever applies.
      const cur = indicator.kind === "incident" ? result.count ?? null : result.pct;
      const prev = indicator.kind === "incident" ? prevResult?.count ?? null : prevResult?.pct ?? null;
      if (cur != null && prev != null && cur !== prev) {
        trend = cur > prev ? "up" : "down";
      }
      return { indicator, result, status, trend };
    });
  }, [kpiResults, kpiViewPair, kpiPrevMonthPair, kpiRecords, records]);

  // Each indicator's own-year trend, plus the prior fiscal year's same 12
  // months merged in alongside it (by month position — both start in
  // October) so the chart can draw a dashed "last year" line next to this
  // year's for an at-a-glance YoY comparison.
  const kpiTrendByIndicator = useMemo(() => {
    if (!fiscalYear) return [];
    return kpiIndicators.map((indicator) => {
      const current = kpiYearTrend(indicator, kpiRecords, records, fiscalYear);
      const prev = kpiYearTrend(indicator, kpiRecords, records, fiscalYear - 1);
      const hasPrevData = prev.some((d) => d.pct != null);
      const data = current.map((d, i) => ({ ...d, pctPrev: prev[i]?.pct ?? null }));
      // Complaints chart as monthly counts rather than "% resolved".
      let complaintCounts: ComplaintCountRow[] | null = null;
      if (indicator.id === "complaint" && indicator.kind === "ratio_pair") {
        const cur = ratioPairCountTrend(indicator, kpiRecords, fiscalYear);
        const prv = ratioPairCountTrend(indicator, kpiRecords, fiscalYear - 1);
        complaintCounts = cur.map((d, i) => ({ ...d, totalPrev: prv[i]?.total ?? null }));
      }
      return { indicator, data, hasPrevData, complaintCounts };
    });
  }, [kpiRecords, records, fiscalYear, kpiIndicators]);

  // One pill per section that's actually rendered below (ids must match the
  // anchors in the JSX). Sections that only show a "no data yet" banner
  // still get a pill so the bar's layout stays the same as data arrives.
  const sectionNavItems: SectionNavItem[] = [
    { id: "sec-summary", label: "สรุปภาพรวม", icon: LayoutDashboard },
    ...(years.length > 0
      ? [
          { id: "sec-service", label: "ผู้รับบริการ", icon: Users },
          { id: "sec-monthly", label: "รายเดือน", icon: CalendarDays },
          { id: "sec-types", label: "ประเภทผู้รับบริการ", icon: Table2 },
        ]
      : []),
    { id: "sec-yearly", label: "แนวโน้มรายปี", icon: CalendarClock },
    { id: "sec-tat", label: "TAT", icon: Timer },
    ...(kpiTrendByIndicator.length > 0
      ? [{ id: "sec-kpi-trend", label: "ตัวชี้วัดรายเดือน", icon: TrendingUp }]
      : []),
  ];

  let content: React.ReactNode;

  if (loading) {
    content = (
      <div className="space-y-6">
        <div className="skeleton h-10 w-72 rounded-field bg-base-200/60" />
        <Skeleton />
      </div>
    );
  } else if (error) {
    content = (
      <StatusBanner
        type="error"
        title="โหลดข้อมูลไม่สำเร็จ"
        message={
          <>
            {error}
            <div className="mt-2 text-xs opacity-75">
              ตรวจสอบว่าได้ตั้งค่า GOOGLE_SHEET_ID และ service account env vars แล้ว
            </div>
          </>
        }
      />
    );
  } else {
    content = (
    <div className="space-y-6 pb-16">
      <section id="sec-summary" className="scroll-mt-24 space-y-6">
      {failedKpis.length > 0 && kpiViewPair && (
        <StatusBanner
          type="warning"
          title={`ตัวชี้วัดคุณภาพไม่ผ่านเกณฑ์ ${failedKpis.length} รายการ · ${MONTH_NAMES_TH[kpiViewPair.month - 1]} ${kpiViewPair.year}`}
          message={failedKpis.map((k) => k.indicator.shortName ?? k.indicator.name).join(" · ")}
        />
      )}

      {kpiError ? (
        <StatusBanner type="error" title="โหลดข้อมูลตัวชี้วัดคุณภาพไม่สำเร็จ" message={kpiError} />
      ) : kpiRecords.length === 0 ? (
        <StatusBanner
          type="info"
          message={
            <>
              ยังไม่มีข้อมูลตัวชี้วัดคุณภาพ — เริ่มกรอกได้ที่หน้า{" "}
              <Link href="/entry" className="link link-primary">กรอกข้อมูล</Link>
            </>
          }
        />
      ) : (
        kpiViewPair && (
          <ExecutiveSummary
            items={executiveSummary}
            icons={KPI_ICON_META}
            accents={KPI_ACCENTS}
            monthLabel={`${MONTH_NAMES_TH[kpiViewPair.month - 1]} ${kpiViewPair.year}`}
            controls={
              <div className="flex items-center gap-1.5">
                <select
                  className="select select-xs select-bordered bg-base-200/60"
                  value={effectiveKpiYear ?? ""}
                  onChange={(e) => {
                    setKpiYear(Number(e.target.value));
                    setKpiMonthIdx(0);
                  }}
                >
                  {kpiYears.map((y) => (
                    <option key={y} value={y}>ปีงบ {y}</option>
                  ))}
                </select>
                <select
                  className="select select-xs select-bordered w-24 bg-base-200/60"
                  value={effectiveKpiMonthIdx >= 0 ? effectiveKpiMonthIdx : ""}
                  onChange={(e) => setKpiMonthIdx(Number(e.target.value))}
                >
                  {kpiMonthOptions.map((m, i) => (
                    <option key={i} value={i}>{monthLabels[i]}</option>
                  ))}
                </select>
              </div>
            }
          />
        )
      )}
      </section>

      {years.length === 0 && (
        <StatusBanner
          type="info"
          message={
            <>
              ยังไม่มีข้อมูลในชีต &quot;ข้อมูลดิบ&quot; — เริ่มกรอกได้ที่หน้า{" "}
              <Link href="/entry" className="link link-primary">กรอกข้อมูล</Link>
            </>
          }
        />
      )}

      {years.length > 0 && (
        <>
          {/* Filters for the ผู้รับบริการ section (not TAT / quality indicators) */}
          <div id="sec-service" className="flex scroll-mt-24 flex-wrap items-end gap-x-3 gap-y-3">
            <FilterField label="มุมมองปี">
              <div className="join" role="group" aria-label="มุมมองปี">
                {(["fiscal", "calendar"] as const).map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    aria-pressed={periodType === pt}
                    onClick={() => {
                      if (pt === periodType) return;
                      setPeriodType(pt);
                      // Month positions mean different months in each mode.
                      setRange("all");
                      setCustomFrom(0);
                      setCustomTo(11);
                    }}
                    className={`btn join-item btn-sm ${periodType === pt ? "btn-primary" : "btn-ghost bg-base-200/60"}`}
                  >
                    {pt === "fiscal" ? "ปีงบประมาณ" : "ปีปฏิทิน"}
                  </button>
                ))}
              </div>
            </FilterField>
            <FilterField label={periodType === "fiscal" ? "ปีงบ" : "ปี พ.ศ."}>
              <select
                className="select select-sm select-bordered w-24 bg-base-200/60"
                value={svcYear ?? ""}
                onChange={(e) =>
                  periodType === "fiscal" ? setFiscalYear(Number(e.target.value)) : setCalYear(Number(e.target.value))
                }
              >
                {svcYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="ช่วงเวลา">
              <select
                className="select select-sm select-bordered w-auto max-w-[15rem] bg-base-200/60"
                value={range}
                onChange={(e) => setRange(e.target.value as RangeKey)}
              >
                {svcYear != null &&
                  rangeOptions(periodType, svcYear).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
              </select>
            </FilterField>
            {range === "custom" && (
              <>
                <FilterField label="จากเดือน">
                  <select
                    className="select select-sm select-bordered w-28 bg-base-200/60"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(Number(e.target.value))}
                  >
                    {months12.map((m, i) => (
                      <option key={i} value={i}>{m.label} {m.year}</option>
                    ))}
                  </select>
                </FilterField>
                <FilterField label="ถึงเดือน">
                  <select
                    className="select select-sm select-bordered w-28 bg-base-200/60"
                    value={customTo}
                    onChange={(e) => setCustomTo(Number(e.target.value))}
                  >
                    {months12.map((m, i) => (
                      <option key={i} value={i}>{m.label} {m.year}</option>
                    ))}
                  </select>
                </FilterField>
              </>
            )}
            <FilterField label="จุดบริการ">
              <select
                className="select select-sm select-bordered w-auto max-w-[14rem] bg-base-200/60"
                value={pointFilter}
                onChange={(e) => setPointFilter(e.target.value)}
              >
                <option value="all">ทุกจุดบริการ</option>
                {SERVICE_POINTS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="ประเภทผู้รับบริการ">
              <CategoryPicker value={categoryFilter} onChange={setCategoryFilter} />
            </FilterField>
            {filtersActive && (
              <button type="button" onClick={resetFilters} className="btn btn-ghost btn-sm text-base-content/60">
                ล้างตัวกรอง
              </button>
            )}
          </div>

          {/* Bento grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:[grid-auto-flow:dense]">
            {/* Hero */}
            <BentoCard i={0} className="sm:col-span-2 lg:col-span-2 lg:row-span-2">
              <div className="flex h-full flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-medium text-base-content/50">
                      <Users size={14} />
                      จำนวนผู้รับบริการ · {scopeLabel}
                    </div>
                    <div className="mt-3 text-4xl font-bold text-base-content sm:text-5xl">
                      <CountUp value={grandTotal} />
                      <span className="ml-2 text-base font-medium text-base-content/40">คน</span>
                    </div>
                  </div>
                  {heroChange && (
                    <div className="flex flex-col items-end gap-1">
                      <div
                        className={`badge gap-1 border-0 ${
                          heroChange.pctChange >= 0
                            ? "bg-success/15 text-success"
                            : "bg-error/15 text-error"
                        }`}
                        title="เทียบกับเดือนเดียวกันของปีก่อน เฉพาะเดือนที่มีข้อมูลทั้งสองปี"
                      >
                        {heroChange.pctChange >= 0 ? (
                          <TrendingUp size={13} />
                        ) : (
                          <TrendingDown size={13} />
                        )}
                        {Math.abs(heroChange.pctChange).toFixed(1)}%
                      </div>
                      <span className="text-right text-[10px] text-base-content/45">
                        เทียบ {heroChange.compared} เดือนเดียวกันของปีก่อน
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-6 h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sparklineData}>
                      <defs>
                        <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-opd)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--color-opd)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Tooltip contentStyle={chartColors.tooltip} labelStyle={{ color: chartColors.tooltip.color }} />
                      <Area
                        type="monotone"
                        dataKey="total"
                        name="ยอดทั้งปี"
                        stroke="var(--color-opd)"
                        strokeWidth={2}
                        fill="url(#heroGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="partialTotal"
                        name="ยอดสะสม (ปีงบยังไม่ครบ)"
                        stroke="var(--color-opd)"
                        strokeOpacity={0.55}
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        fill="none"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/40">
                  แนวโน้ม 6 ปีล่าสุด{pointFilter !== "all" || categoryFilter !== "all" ? " (ทุกจุดบริการ ทุกประเภท)" : ""}
                  {incompleteTrend && (
                    <span className="rounded-field bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      ปีงบ {incompleteTrend.year} ยังไม่ครบ ({incompleteTrend.filledMonths}/12 เดือน) · เส้นประ
                    </span>
                  )}
                </div>
              </div>
            </BentoCard>

            {/* Per-point mini stats */}
            {displayByPoint.map((p, idx) => {
              const meta = pointMeta(p.point);
              const Icon = meta.icon;
              const pct = grandTotal > 0 ? (p.total / grandTotal) * 100 : 0;
              return (
                <BentoCard key={p.point} i={idx + 1}>
                  <div className="flex items-center justify-between">
                    <span
                      className="icon-badge flex h-9 w-9 items-center justify-center rounded-field"
                      style={{ background: `color-mix(in oklab, ${meta.color} 18%, transparent)`, color: meta.color }}
                    >
                      <Icon size={17} strokeWidth={2.2} />
                    </span>
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-base-content">
                      <CountUp value={p.total} />
                    </span>
                    <span className="stat-figure-num text-xs font-semibold" style={{ color: meta.color }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium text-base-content/70">{p.point}</div>
                </BentoCard>
              );
            })}
          </div>

          {/* Monthly stacked bar */}
          <BentoCard i={5} id="sec-monthly" className="scroll-mt-24 !p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-base-content">
                จำนวนผู้รับบริการรายเดือน แยกตามจุดบริการ
              </h2>
              <span className="text-xs text-base-content/40">
                {yearLabel}{filterSuffix ? ` · ${filterSuffix}` : ""}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyChartData} barCategoryGap={18} barSize={24}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: chartColors.axisTick }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: chartColors.axisTick }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartColors.tooltip} cursor={{ fill: chartColors.cursor }} />
                <Legend wrapperStyle={{ fontSize: 12, color: chartColors.axisTick }} />
                {shownPoints.map((p, pIdx) => (
                  <Bar
                    key={p}
                    dataKey={p}
                    stackId="a"
                    fill={pointMeta(p).color}
                    radius={pIdx === shownPoints.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  >
                    {monthlyChartData.map((_, i) => (
                      <Cell key={i} fillOpacity={isSelected(i) ? 1 : 0.25} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </BentoCard>

          {/* Share by ประเภทผู้รับบริการ, per จุดบริการ — ranked bar list */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {shownPoints.map((point, idx) => {
              const data = typeTotals(svcRecords, selMonths, point);
              if (!data.length) return null;
              const meta = pointMeta(point);
              return (
                <BentoCard key={point} i={6 + idx} className="!p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-base-content/70">
                      <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                      {point}
                    </h3>
                    <span className="text-[11px] text-base-content/35">{scopeLabel}</span>
                  </div>
                  <TypeBreakdownBars data={data} palette={meta.palette} />
                </BentoCard>
              );
            })}
          </div>

          {/* ประเภทผู้รับบริการ — 10 groups across all จุดบริการ, by month */}
          {svcYear != null && (
            <PatientCategoryCard
              records={pointRecords}
              months={months12}
              selectedIdx={range === "all" ? null : selIdx}
              categories={categoryFilter}
              yearLabel={yearLabel}
              scopeLabel={scopeLabel}
              colors={chartColors}
              i={8}
            />
          )}
        </>
      )}

      {/* Yearly trend */}
      <BentoCard i={9} id="sec-yearly" className="scroll-mt-24 !p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="icon-badge flex h-7 w-7 items-center justify-center rounded-field bg-primary/15 text-primary">
              <CalendarClock size={14} strokeWidth={2.2} />
            </span>
            <h2 className="text-sm font-semibold text-base-content">แนวโน้มยอดผู้รับบริการรายปี</h2>
            {incompleteTrend && (
              <span className="rounded-field bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                ปีงบ {incompleteTrend.year} ยังไม่ครบ ({incompleteTrend.filledMonths}/12 เดือน)
              </span>
            )}
          </div>
          {forecast && (
            <span className="flex items-center gap-1.5 rounded-field bg-info/15 px-2.5 py-1 text-xs font-medium text-info">
              <TrendingUp size={12} />
              พยากรณ์ปีงบ {forecast.year}: {forecast.total.toLocaleString()} คน
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trendChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12, fill: chartColors.axisTick }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: chartColors.axisTick }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={chartColors.tooltip}
              formatter={(value, name) => [
                value == null ? "-" : `${Number(value).toLocaleString()} คน`,
                name,
              ]}
            />
            {(forecast || incompleteTrend) && <Legend wrapperStyle={{ fontSize: 11, color: chartColors.axisTick }} />}
            <Line
              type="monotone"
              dataKey="total"
              name="ยอดจริง"
              stroke="var(--color-opd)"
              strokeWidth={2.5}
              dot={{ r: 3, fill: "var(--color-opd)", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
            {incompleteTrend && (
              <Line
                type="monotone"
                dataKey="partialTotal"
                name="ยอดสะสม (ปีงบยังไม่ครบ)"
                stroke="var(--color-opd)"
                strokeOpacity={0.6}
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: "var(--color-opd)", strokeWidth: 0 }}
                connectNulls
              />
            )}
            {forecast && (
              <Line
                type="monotone"
                dataKey="forecastTotal"
                name="พยากรณ์"
                stroke={chartColors.axisTick}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 3, fill: chartColors.axisTick, strokeWidth: 0 }}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-content/8 text-base-content/40">
                <th className="py-1.5 text-left font-medium">ปี</th>
                <th className="py-1.5 text-right font-medium">รวม</th>
                <th className="py-1.5 text-right font-medium">% เปลี่ยนแปลง</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.year} className="border-b border-base-content/5">
                  <td className="py-1.5 text-base-content/70">
                    {t.year}
                    {!t.complete && (
                      <span className="ml-1.5 rounded-field bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        ยังไม่ครบ {t.filledMonths}/12 เดือน
                      </span>
                    )}
                  </td>
                  <td className="stat-figure-num py-1.5 text-right text-base-content/90">
                    {t.total.toLocaleString()}
                  </td>
                  <td
                    className={`py-1.5 text-right ${
                      t.pctChange != null && t.pctChange < 0 ? "text-error" : "text-success"
                    }`}
                  >
                    {t.pctChange == null ? "-" : `${t.pctChange.toFixed(1)}%`}
                    {!t.complete && t.pctChange != null && (
                      <div className="text-[10px] text-base-content/40">
                        เทียบ {comparedMonthsLabel(t.comparedMonths)} ปีก่อน
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {forecast && (
                <tr className="border-b border-base-content/5 text-base-content/40 italic">
                  <td className="py-1.5">
                    {forecast.year}{" "}
                    <span className="not-italic rounded-field bg-info/15 px-1.5 py-0.5 text-[10px] font-medium text-info">
                      พยากรณ์
                    </span>
                  </td>
                  <td className="stat-figure-num py-1.5 text-right">{forecast.total.toLocaleString()}</td>
                  <td className="py-1.5 text-right">
                    {forecast.pctChange == null ? "-" : `${forecast.pctChange.toFixed(1)}%`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-base-content/35">
          ปี 2563-2568: ยอดรวมจากไฟล์เดิม (ไม่แยกจุดบริการ) · ปี 2569 เป็นต้นไป: คำนวณจากข้อมูลที่กรอกจริง
          {forecast && " · พยากรณ์: เส้นแนวโน้มเชิงเส้นอย่างง่ายจากปีงบที่มีข้อมูลครบ 12 เดือน ไม่ได้คำนึงถึงปัจจัยอื่น เช่น การเปลี่ยนแปลงกำลังคนหรือนโยบาย"}
        </p>
      </BentoCard>

      {/* TAT section */}
      <section id="sec-tat" className="scroll-mt-24">
      {tatError ? (
        <StatusBanner type="error" title="โหลดข้อมูล TAT ไม่สำเร็จ" message={tatError} className="mt-8" />
      ) : tatYears.length > 0 && tatYear ? (
        <>
          <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="icon-badge flex h-7 w-7 items-center justify-center rounded-field bg-accent/15 text-accent">
                <Timer size={14} strokeWidth={2.2} />
              </span>
              <h2 className="text-sm font-semibold text-base-content">
                ระยะเวลาการให้บริการเฉลี่ย (TAT) ช่วงเวลา 6.00-9.00 น.
              </h2>
            </div>
            <select
              className="select select-sm select-bordered w-28 bg-base-200/60"
              value={tatYear}
              onChange={(e) => setTatYear(Number(e.target.value))}
            >
              {tatYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Side-by-side point comparison — all 4 จุดบริการ in one chart,
              instead of needing to look at one point's history at a time
              further down. */}
          {tatCompare.month && (
            <BentoCard i={10} className="mb-4 !p-5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-base-content">
                  เปรียบเทียบ 4 จุดบริการ
                </h3>
                <span className="text-xs text-base-content/40">
                  {tatMonths[tatCompare.month - 1]} {tatYear}
                </span>
              </div>
              {tatCompareRanked && (
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  <span className="flex items-center gap-1.5 rounded-field bg-success/15 px-2 py-1 text-success">
                    <Timer size={11} /> เร็วสุด {pointMeta(tatCompareRanked.fastest.point).short} ·{" "}
                    {tatCompareRanked.fastest.total.toFixed(1)} น.
                  </span>
                  <span className="flex items-center gap-1.5 rounded-field bg-error/15 px-2 py-1 text-error">
                    <Timer size={11} /> ช้าสุด {pointMeta(tatCompareRanked.slowest.point).short} ·{" "}
                    {tatCompareRanked.slowest.total.toFixed(1)} น.
                  </span>
                </div>
              )}
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={tatCompare.rows} barCategoryGap={28} barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis
                    dataKey="point"
                    tickFormatter={(point: string) => pointMeta(point).short}
                    tick={{ fontSize: 11, fill: chartColors.axisTick }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 11, fill: chartColors.axisTick }} axisLine={false} tickLine={false} unit="น." />
                  <Tooltip
                    contentStyle={chartColors.tooltip}
                    formatter={(value, name) => [value == null ? "ไม่มีข้อมูล" : `${Number(value).toFixed(1)} นาที`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: chartColors.axisTick }} />
                  {TAT_STAGES.map((stage) => {
                    const sMeta = TAT_STAGE_META[stage];
                    return (
                      <Bar
                        key={stage}
                        dataKey={stage}
                        name={sMeta.short}
                        fill={sMeta.color}
                        fillOpacity={sMeta.total ? 1 : 0.65}
                        radius={[3, 3, 0, 0]}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </BentoCard>
          )}

          <div className="mb-3 text-xs font-medium text-base-content/40">รายละเอียดแนวโน้มแต่ละจุดบริการ</div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {tatChartDataByPoint.map(({ point, data }, idx) => {
              const meta = pointMeta(point);
              return (
                <BentoCard key={point} i={11 + idx} className="!p-5">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-base-content">
                    <span style={{ color: meta.color }}>{meta.short}</span>
                    <span className="text-xs font-normal text-base-content/40">{point}</span>
                  </h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: chartColors.axisTick }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: chartColors.axisTick }} axisLine={false} tickLine={false} unit="น." />
                      <Tooltip
                        contentStyle={chartColors.tooltip}
                        formatter={(value, name) => [`${Number(value).toFixed(1)} นาที`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10, color: chartColors.axisTick }} />
                      {Object.entries(TAT_STAGE_META).map(([stage, sMeta]) => (
                        <Line
                          key={stage}
                          type="monotone"
                          dataKey={stage}
                          name={sMeta.short}
                          stroke={sMeta.color}
                          strokeWidth={sMeta.total ? 2.75 : 1.75}
                          dot={{ r: 3, strokeWidth: 0, fill: sMeta.color }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </BentoCard>
              );
            })}
          </div>
        </>
      ) : (
        <StatusBanner
          type="info"
          className="mt-8"
          message={
            <>
              ยังไม่มีข้อมูล TAT — เริ่มกรอกได้ที่หน้า{" "}
              <Link href="/entry" className="link link-primary">กรอกข้อมูล</Link>
            </>
          }
        />
      )}
      </section>

      {/* Per-indicator trend charts — kept separate from the detailed score
          tiles (removed per request): this is the "how did each indicator
          move over the fiscal year" view, not a duplicate of the one-month
          summary above. */}
      {kpiTrendByIndicator.length > 0 && (
        <>
          <div id="sec-kpi-trend" className="mb-3 mt-8 flex scroll-mt-24 items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-base-content/50">แนวโน้มรายตัวชี้วัด</h3>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-base-content/60">
              <input
                type="checkbox"
                className="toggle toggle-xs toggle-primary"
                checked={showYoY}
                onChange={(e) => setShowYoY(e.target.checked)}
              />
              เทียบปีงบก่อนหน้า (YoY)
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {kpiTrendByIndicator.map(({ indicator, data, hasPrevData, complaintCounts }, idx) => {
              const showPrev = complaintCounts
                ? showYoY && complaintCounts.some((d) => d.totalPrev != null)
                : showYoY && hasPrevData;
              const incidentMax = indicator.kind === "incident" ? indicator.maxPerYear : undefined;
              const latestIncident = [...data].reverse().find((d) => d.count != null);
              const axis = zoomedPercentAxis(
                showPrev ? data.flatMap((d) => [d.pct, d.pctPrev]) : data.map((d) => d.pct),
                indicator.target?.value
              );
              return (
              <BentoCard key={indicator.id} i={23 + idx} className="!p-5">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-base-content/70">
                    {complaintCounts ? "จำนวนเรื่องร้องเรียนรายเดือน" : (indicator.shortName ?? indicator.name)}
                  </h3>
                  {!complaintCounts && indicator.target && !axis.targetInRange && (
                    <span className="shrink-0 text-[10px] text-base-content/35">
                      เป้าหมาย {indicator.target.value}%
                    </span>
                  )}
                </div>
                {complaintCounts ? (
                  <ComplaintCountChart
                    data={complaintCounts}
                    showPrev={showPrev}
                    label={showPrev ? `ปีงบ ${fiscalYear}` : "จำนวนเรื่องร้องเรียน"}
                    prevLabel={`ปีงบ ${(fiscalYear ?? 0) - 1}`}
                    colors={chartColors}
                  />
                ) : indicator.kind === "incident" ? (
                  <div className="flex h-[180px] flex-col justify-center gap-2">
                    <div className="grid grid-cols-12 gap-1.5">
                      {data.map((d, i) => (
                        <div
                          key={i}
                          title={`${d.month}: ${d.count == null ? "ไม่มีข้อมูล" : `${d.count} ครั้ง`}${
                            d.ytdCount != null ? ` (สะสม ${d.ytdCount} ครั้ง)` : ""
                          } · ${d.status === "pass" ? "PASS" : d.status === "fail" ? "FAIL" : "-"}`}
                          className={`flex h-9 items-center justify-center rounded-field text-xs font-semibold ${
                            d.status === "pass"
                              ? "bg-success/15 text-success"
                              : d.status === "fail"
                                ? "bg-error/15 text-error"
                                : "bg-base-200/50 text-base-content/25"
                          }`}
                        >
                          {d.count == null ? <span className="text-[10px] font-normal">–</span> : d.count}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-12 gap-1.5">
                      {data.map((d, i) => (
                        <span key={i} className="text-center text-[9px] text-base-content/35">{d.month}</span>
                      ))}
                    </div>
                    {latestIncident && (
                      <div className="text-center text-[11px] text-base-content/50">
                        {incidentMax != null
                          ? `สะสมปีงบ ${latestIncident.ytdCount ?? latestIncident.count}/${incidentMax} ครั้ง (เกณฑ์ไม่เกิน ${incidentMax} ครั้งต่อปี)`
                          : "จำนวนครั้งต่อเดือน (เกณฑ์ 0 ครั้ง)"}
                      </div>
                    )}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: chartColors.axisTick }} axisLine={false} tickLine={false} />
                      <YAxis
                        domain={axis.domain}
                        ticks={axis.ticks}
                        tick={{ fontSize: 11, fill: chartColors.axisTick }}
                        axisLine={false}
                        tickLine={false}
                        unit="%"
                      />
                      <Tooltip
                        contentStyle={chartColors.tooltip}
                        formatter={(value, name) => [`${Number(value).toFixed(indicator.decimals ?? 1)}%`, name]}
                      />
                      {showPrev && (
                        <Legend wrapperStyle={{ fontSize: 10, color: chartColors.axisTick }} />
                      )}
                      {indicator.target && axis.targetInRange && (
                        <ReferenceLine
                          y={indicator.target.value}
                          stroke={chartColors.axisTick}
                          strokeDasharray="4 4"
                          strokeOpacity={0.6}
                          label={{
                            value: `เป้าหมาย ${indicator.target.value}%`,
                            position: "insideTopRight",
                            fontSize: 10,
                            fill: chartColors.axisTick,
                          }}
                        />
                      )}
                      {showPrev && (
                        <Line
                          type="monotone"
                          dataKey="pctPrev"
                          name={`ปีงบ ${(fiscalYear ?? 0) - 1}`}
                          stroke={chartColors.axisTick}
                          strokeWidth={1.75}
                          strokeDasharray="5 5"
                          dot={false}
                          connectNulls
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="pct"
                        name={showPrev ? `ปีงบ ${fiscalYear}` : (indicator.shortName ?? indicator.name)}
                        stroke="var(--color-opd)"
                        strokeWidth={2.25}
                        dot={{ r: 3, strokeWidth: 0, fill: "var(--color-opd)" }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </BentoCard>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-base-content/35">
            เกณฑ์ประเมินของแต่ละตัวชี้วัดเป็นค่าเริ่มต้น — ปรับข้อความเกณฑ์จริงได้ที่หน้ากรอกข้อมูล (ตัวชี้วัดคุณภาพ)
          </p>
        </>
      )}

    </div>
    );
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="icon-badge flex h-10 w-10 shrink-0 items-center justify-center rounded-field bg-error/15 text-error">
            <Droplet size={19} strokeWidth={2.4} fill="currentColor" fillOpacity={0.25} />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-base-content sm:text-2xl">
              สถิติงานบริการหน่วยเจาะเลือด เก็บสิ่งส่งตรวจ และ POCT
            </h1>
            <p className="mt-1 text-sm text-base-content/50">โรงพยาบาลศรีนครินทร์</p>
            <LiveClock className="mt-1.5" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <Link
            href="/entry"
            title="เข้าสู่ระบบกรอกข้อมูล"
            aria-label="เข้าสู่ระบบกรอกข้อมูล"
            className="btn btn-circle btn-ghost glass-panel border-0 text-base-content/60 hover:text-primary"
          >
            <KeyRound size={18} strokeWidth={2.2} />
          </Link>
        </div>
      </div>

      {!loading && !error && <SectionNav items={sectionNavItems} />}

      {content}
    </div>
  );
}
