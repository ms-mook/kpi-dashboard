import legacyData from "./legacy-data.json";
import { fiscalYearMonths, MONTH_ABBR_TH } from "./constants";

export type RecordRow = {
  year: number;
  month: number;
  point: string;
  type: string;
  count: number;
};

export type LegacyYear = { year: number; months: number[] };

export function getLegacyYears(): LegacyYear[] {
  return legacyData as LegacyYear[];
}

/** All fiscal years that have at least one row in the live records. */
export function availableFiscalYears(records: RecordRow[]): number[] {
  const set = new Set<number>();
  for (const r of records) {
    const fy = r.month >= 10 ? r.year + 1 : r.year;
    set.add(fy);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Sum of `count` for a given (year, month), across all points/types.
 * Exported so other domains (e.g. KPI indicators) can pull the attendance
 * total for a month without duplicating the filter/reduce. */
export function monthTotal(records: RecordRow[], year: number, month: number): number {
  return records
    .filter((r) => r.year === year && r.month === month)
    .reduce((s, r) => s + r.count, 0);
}

/** Monthly totals (Oct..Sep) for one fiscal year, broken down by จุดบริการ. */
export function fiscalYearByPoint(records: RecordRow[], fiscalYear: number, points: readonly string[]) {
  const months = fiscalYearMonths(fiscalYear);
  return points.map((point) => {
    const values = months.map(({ year, month }) =>
      records
        .filter((r) => r.year === year && r.month === month && r.point === point)
        .reduce((s, r) => s + r.count, 0)
    );
    return { point, values, total: values.reduce((a, b) => a + b, 0) };
  });
}

/** Per-จุดบริการ totals for a single (year, month) — powers the dashboard's
 * month drill-down (vs. the whole-fiscal-year fiscalYearByPoint). */
export function monthByPoint(records: RecordRow[], year: number, month: number, points: readonly string[]) {
  return points.map((point) => ({
    point,
    total: records
      .filter((r) => r.year === year && r.month === month && r.point === point)
      .reduce((s, r) => s + r.count, 0),
  }));
}

/** Breakdown by ประเภทผู้รับบริการ within one จุดบริการ, for a single
 * (year, month) — the month-scoped counterpart to fiscalYearByType. */
export function monthByType(records: RecordRow[], year: number, month: number, point: string) {
  const types = Array.from(
    new Set(records.filter((r) => r.point === point).map((r) => r.type))
  );
  return types
    .map((type) => {
      const total = records
        .filter((r) => r.year === year && r.month === month && r.point === point && r.type === type)
        .reduce((s, r) => s + r.count, 0);
      return { type, total };
    })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Breakdown by ประเภทผู้รับบริการ within one จุดบริการ, for a fiscal year. */
export function fiscalYearByType(records: RecordRow[], fiscalYear: number, point: string) {
  const months = fiscalYearMonths(fiscalYear);
  const types = Array.from(
    new Set(records.filter((r) => r.point === point).map((r) => r.type))
  );
  return types
    .map((type) => {
      const total = months.reduce(
        (s, { year, month }) =>
          s +
          records
            .filter((r) => r.year === year && r.month === month && r.point === point && r.type === type)
            .reduce((a, b) => a + b.count, 0),
        0
      );
      return { type, total };
    })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Full year-at-a-glance table: one row per (จุดบริการ, ประเภท), monthly
 * values Oct..Sep plus a yearly total. Powers the read-only summary table
 * on the entry page so the user doesn't need to flip month-by-month. */
export function fiscalYearTable(
  records: RecordRow[],
  fiscalYear: number,
  pairs: { point: string; type: string }[]
) {
  const months = fiscalYearMonths(fiscalYear);
  return pairs.map(({ point, type }) => {
    const values = months.map(({ year, month }) =>
      records
        .filter((r) => r.year === year && r.month === month && r.point === point && r.type === type)
        .reduce((s, r) => s + r.count, 0)
    );
    return { point, type, values, total: values.reduce((a, b) => a + b, 0) };
  });
}

export function fiscalMonthLabels() {
  // Oct..Sep abbreviations
  return [MONTH_ABBR_TH[9], MONTH_ABBR_TH[10], MONTH_ABBR_TH[11], ...MONTH_ABBR_TH.slice(0, 9)];
}

/** Combined yearly trend: legacy (static) years + live years computed from
 * records, keyed by calendar ปี พ.ศ., with month-by-month totals and YoY %. */
export function yearlyTrend(records: RecordRow[]) {
  const legacy = getLegacyYears();
  // Oct..Sep fiscal years (the same convention every other summary in this
  // app uses — see fiscalYearMonths), not raw calendar r.year groups: a
  // fiscal year's Oct-Dec rows are stored under the earlier calendar year,
  // so grouping by r.year directly used to split one fiscal year's total
  // across two rows and silently drop the Oct-Dec portion wherever a
  // legacy row already claimed the earlier calendar year number.
  const liveFiscalYears = availableFiscalYears(records);

  // `byMonth` maps month-of-year (1..12) → that month's total, only for
  // months that actually have data. Keyed by month number rather than array
  // position because the two sources are ordered differently: legacy rows
  // are calendar Jan..Dec, live rows are fiscal Oct..Sep.
  type TrendRow = { year: number; months: number[]; total: number; byMonth: Map<number, number> };

  const rows: TrendRow[] = legacy.map((y) => {
    const byMonth = new Map<number, number>();
    y.months.forEach((v, i) => {
      if (v > 0) byMonth.set(i + 1, v);
    });
    return { year: y.year, months: y.months, total: y.months.reduce((a, b) => a + b, 0), byMonth };
  });

  const present = new Set(records.map((r) => `${r.year}-${r.month}`));
  for (const fiscalYear of liveFiscalYears) {
    if (rows.some((r) => r.year === fiscalYear)) continue;
    const fyMonths = fiscalYearMonths(fiscalYear);
    const months = fyMonths.map(({ year, month }) => monthTotal(records, year, month));
    const byMonth = new Map<number, number>();
    fyMonths.forEach(({ year, month }, i) => {
      if (present.has(`${year}-${month}`)) byMonth.set(month, months[i]);
    });
    rows.push({ year: fiscalYear, months, total: months.reduce((a, b) => a + b, 0), byMonth });
  }

  rows.sort((a, b) => a.year - b.year);

  return rows.map((row, i) => {
    const filledMonths = row.byMonth.size;
    const complete = filledMonths >= 12;
    const prevRow = i > 0 ? rows[i - 1] : null;
    // Like-for-like: only months that have data in BOTH this year and the
    // year before, matched by month-of-year. A year still in progress (say
    // just ต.ค.) is then compared against last year's ต.ค. only — not
    // against last year's full 12-month total, which used to show a huge
    // fake "drop" every October.
    let pctChange: number | null = null;
    const comparedMonths: number[] = [];
    if (prevRow) {
      let cur = 0;
      let prev = 0;
      for (const [m, v] of row.byMonth) {
        const p = prevRow.byMonth.get(m);
        if (p == null) continue;
        cur += v;
        prev += p;
        comparedMonths.push(m);
      }
      pctChange = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    }
    const { byMonth: _byMonth, ...rest } = row;
    void _byMonth;
    return { ...rest, pctChange, filledMonths, complete, comparedMonths };
  });
}
