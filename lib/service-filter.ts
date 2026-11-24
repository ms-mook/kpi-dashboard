import { MONTH_ABBR_TH, MONTH_NAMES_TH, fiscalYearMonths } from "./constants";
import type { RecordRow } from "./aggregate";
import { patientCategoryOf, type PatientCategoryKey } from "./patient-categories";

/** Filters for the ผู้รับบริการ section of the dashboard: which 12-month year
 * (fiscal Oct–Sep or calendar Jan–Dec), which part of it (whole year,
 * quarter, half, one month or a custom from–to span), which จุดบริการ and
 * which ประเภทผู้รับบริการ groups. Pure functions so the numbers can be
 * tested without the UI. */

export type PeriodType = "fiscal" | "calendar";
export type RangeKey = "all" | "q1" | "q2" | "q3" | "q4" | "h1" | "h2" | "custom" | `m${number}`;
export type YM = { year: number; month: number; label: string };

/** The 12 (ปี พ.ศ., เดือน) of a fiscal or calendar year, in display order. */
export function yearMonths(periodType: PeriodType, year: number): YM[] {
  const pairs =
    periodType === "fiscal"
      ? fiscalYearMonths(year)
      : Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }));
  return pairs.map((p) => ({ ...p, label: MONTH_ABBR_TH[p.month - 1] }));
}

/** Years that have at least one record, as fiscal or calendar years. */
export function availableYears(records: RecordRow[], periodType: PeriodType): number[] {
  const set = new Set<number>();
  for (const r of records) set.add(periodType === "fiscal" && r.month >= 10 ? r.year + 1 : r.year);
  return Array.from(set).sort((a, b) => a - b);
}

const RANGE_SPANS: Record<string, [number, number]> = {
  all: [0, 11], q1: [0, 2], q2: [3, 5], q3: [6, 8], q4: [9, 11], h1: [0, 5], h2: [6, 11],
};

/** Indices (0..11, into yearMonths) the range covers. For "custom", `from`
 * and `to` are those indices; they're swapped if given backwards. */
export function rangeIndices(range: RangeKey, from = 0, to = 11): number[] {
  let lo: number;
  let hi: number;
  if (/^m\d+$/.test(range)) {
    lo = hi = Math.min(11, Math.max(0, Number(range.slice(1)) || 0));
  } else if (range === "custom") {
    lo = Math.max(0, Math.min(from, to));
    hi = Math.min(11, Math.max(from, to));
  } else {
    [lo, hi] = RANGE_SPANS[range] ?? RANGE_SPANS.all;
  }
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

const span = (m: YM[], a: number, b: number) => `${m[a].label}–${m[b].label}`;

/** Options for the "ช่วงเวลา" select, labelled for the chosen year type. */
export function rangeOptions(periodType: PeriodType, year: number): { value: RangeKey; label: string }[] {
  const m = yearMonths(periodType, year);
  return [
    { value: "all", label: "ทั้งปี" },
    { value: "q1", label: `ไตรมาส 1 (${span(m, 0, 2)})` },
    { value: "q2", label: `ไตรมาส 2 (${span(m, 3, 5)})` },
    { value: "q3", label: `ไตรมาส 3 (${span(m, 6, 8)})` },
    { value: "q4", label: `ไตรมาส 4 (${span(m, 9, 11)})` },
    { value: "h1", label: `ครึ่งปีแรก (${span(m, 0, 5)})` },
    { value: "h2", label: `ครึ่งปีหลัง (${span(m, 6, 11)})` },
    ...m.map((ym, i) => ({ value: `m${i}` as RangeKey, label: `${MONTH_NAMES_TH[ym.month - 1]} ${ym.year}` })),
    { value: "custom", label: "กำหนดช่วงเดือนเอง…" },
  ];
}

/** Human label for the selected period, e.g. "ไตรมาส 1 ปีงบ 2570". */
export function periodLabel(periodType: PeriodType, year: number, range: RangeKey, from = 0, to = 11): string {
  const yearText = periodType === "fiscal" ? `ปีงบ ${year}` : `ปีปฏิทิน ${year}`;
  const m = yearMonths(periodType, year);
  const idx = rangeIndices(range, from, to);
  if (range === "all") return yearText;
  if (/^q[1-4]$/.test(range)) return `ไตรมาส ${range[1]} ${yearText}`;
  if (range === "h1") return `ครึ่งปีแรก ${yearText}`;
  if (range === "h2") return `ครึ่งปีหลัง ${yearText}`;
  if (idx.length === 1) return `เดือน${MONTH_NAMES_TH[m[idx[0]].month - 1]} ${m[idx[0]].year}`;
  const a = m[idx[0]];
  const b = m[idx[idx.length - 1]];
  return a.year === b.year
    ? `${a.label}–${b.label} ${a.year}`
    : `${a.label} ${a.year} – ${b.label} ${b.year}`;
}

/** Records limited to one จุดบริการ ("all" = every point) and to the chosen
 * ประเภทผู้รับบริการ groups ("all" = every group). */
export function filterRecords(
  records: RecordRow[],
  point: string,
  categories: PatientCategoryKey[] | "all"
): RecordRow[] {
  const cats = categories === "all" ? null : new Set(categories);
  return records.filter(
    (r) => (point === "all" || r.point === point) && (!cats || cats.has(patientCategoryOf(r.point, r.type)))
  );
}

const ymKey = (year: number, month: number) => `${year}-${month}`;

function sumByMonth(records: RecordRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of records) {
    const k = ymKey(r.year, r.month);
    map.set(k, (map.get(k) ?? 0) + r.count);
  }
  return map;
}

/** Per-จุดบริการ monthly totals across the 12 months (for the stacked chart). */
export function pointMonthly(records: RecordRow[], months: YM[], points: readonly string[]) {
  return points.map((point) => {
    const sums = sumByMonth(records.filter((r) => r.point === point));
    return { point, values: months.map((m) => sums.get(ymKey(m.year, m.month)) ?? 0) };
  });
}

/** Total of `records` over the given months. */
export function totalOver(records: RecordRow[], months: { year: number; month: number }[]): number {
  const keys = new Set(months.map((m) => ymKey(m.year, m.month)));
  return records.reduce((s, r) => (keys.has(ymKey(r.year, r.month)) ? s + r.count : s), 0);
}

/** ประเภท (raw type) totals at one จุดบริการ over the given months, largest first. */
export function typeTotals(records: RecordRow[], months: { year: number; month: number }[], point: string) {
  const keys = new Set(months.map((m) => ymKey(m.year, m.month)));
  const map = new Map<string, number>();
  for (const r of records) {
    if (r.point !== point || !keys.has(ymKey(r.year, r.month))) continue;
    map.set(r.type, (map.get(r.type) ?? 0) + r.count);
  }
  return Array.from(map, ([type, total]) => ({ type, total }))
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Like-for-like change vs the same months one year earlier: only months
 * entered in BOTH years count (a month is "entered" when `allRecords` has
 * any row for it, so a filtered-out zero still counts as data). Values come
 * from the filtered `records`. null when nothing comparable exists. */
export function sameMonthsLastYear(
  records: RecordRow[],
  allRecords: RecordRow[],
  months: { year: number; month: number }[]
): { pctChange: number; compared: number } | null {
  const entered = new Set(allRecords.map((r) => ymKey(r.year, r.month)));
  const sums = sumByMonth(records);
  let cur = 0;
  let prev = 0;
  let compared = 0;
  for (const { year, month } of months) {
    if (!entered.has(ymKey(year, month)) || !entered.has(ymKey(year - 1, month))) continue;
    cur += sums.get(ymKey(year, month)) ?? 0;
    prev += sums.get(ymKey(year - 1, month)) ?? 0;
    compared++;
  }
  if (!compared || prev <= 0) return null;
  return { pctChange: ((cur - prev) / prev) * 100, compared };
}

/** Months (of the given list) that have any data at all. */
export function enteredMonths(allRecords: RecordRow[], months: { year: number; month: number }[]) {
  const entered = new Set(allRecords.map((r) => ymKey(r.year, r.month)));
  return months.filter((m) => entered.has(ymKey(m.year, m.month)));
}
