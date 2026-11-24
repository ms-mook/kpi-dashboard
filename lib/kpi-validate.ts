import type { KpiIndicator } from "./constants";

/** A numerator that's larger than its denominator, e.g. "รอไม่เกิน 30 นาที
 * 30,924" vs "ผู้รับบริการทั้งหมด 30,201" — which would show as >100%. */
export type RatioIssue = {
  indicatorId: string;
  indicatorName: string;
  numeratorLabel: string;
  denominatorLabel: string;
  numerator: number;
  denominator: number;
};

const toNum = (v: string | undefined | null): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isTrue = (v: string | undefined | null) => v === "TRUE" || v === "true" || v === "1";

/** Every place in one month's KPI values where a count-part exceeds its
 * count-whole. `get` returns a field's raw value for that month.
 * `attendanceTotal` (the month's ผู้รับบริการ total) is the denominator for
 * "ratio_auto" and the fallback for an unset "ratio_editable" denominator;
 * when it's unknown or 0, those checks are skipped. */
export function ratioIssues(
  indicators: KpiIndicator[],
  get: (indicatorId: string, field: string) => string | undefined,
  attendanceTotal?: number
): RatioIssue[] {
  const out: RatioIssue[] = [];
  const att = attendanceTotal != null && attendanceTotal > 0 ? attendanceTotal : null;

  for (const ind of indicators) {
    const name = ind.shortName ?? ind.name;
    const check = (numeratorLabel: string, denominatorLabel: string, n: number | null, d: number | null) => {
      if (n != null && d != null && n > d) {
        out.push({ indicatorId: ind.id, indicatorName: name, numeratorLabel, denominatorLabel, numerator: n, denominator: d });
      }
    };
    switch (ind.kind) {
      case "ratio_auto":
        check(ind.numerator.label, "จำนวนผู้รับบริการทั้งหมด", toNum(get(ind.id, ind.numerator.key)), att);
        break;
      case "ratio_editable":
        check(
          ind.numerator.label,
          ind.denominator.label,
          toNum(get(ind.id, ind.numerator.key)),
          toNum(get(ind.id, ind.denominator.key)) ?? att
        );
        break;
      case "ratio_pair":
        check(ind.numerator.label, ind.denominator.label, toNum(get(ind.id, ind.numerator.key)), toNum(get(ind.id, ind.denominator.key)));
        break;
      case "pm":
        for (const g of ind.groups) {
          if (isTrue(get(ind.id, `${g.key}_pending`))) continue;
          check(
            `${g.label}: จำนวนที่ทำสำเร็จ`,
            `${g.label}: จำนวนทั้งหมด`,
            toNum(get(ind.id, `${g.key}_success`)),
            toNum(get(ind.id, `${g.key}_total`))
          );
        }
        break;
      default:
        break;
    }
  }
  return out;
}

/** One-line Thai description of an issue, for error messages. */
export function describeRatioIssue(i: RatioIssue): string {
  const f = (n: number) => n.toLocaleString("en-US");
  return `${i.indicatorName}: ${i.numeratorLabel} (${f(i.numerator)}) มากกว่า ${i.denominatorLabel} (${f(i.denominator)})`;
}
