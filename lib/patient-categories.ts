import { fiscalYearMonths, MONTH_ABBR_TH } from "./constants";
import type { RecordRow } from "./aggregate";

/** The 10 ประเภทผู้รับบริการ groups the dashboard compares across months,
 * built from the raw (จุดบริการ, ประเภท) rows:
 *  - 1-5 combine ห้องเจาะเลือด OPD + กว. (same type names at both points)
 *  - 6-8 are SMC's own types (สูงอายุ/รถเข็น SMC kept separate by request)
 *  - ส่งสิ่งส่งตรวจ sums OPD + กว. + SMC
 *  - ตรวจสุขภาพบุคลากร is everything at ห้องเจาะเลือดงานเวชกรรมฯ
 * Any row that matches none of these (a type added or renamed later in the
 * service-points admin) lands in "other", so the groups always add up to the
 * month's real total and nobody silently drops out of the chart. */
export const PATIENT_CATEGORIES = [
  { key: "general", label: "ผู้รับบริการทั่วไป" },
  { key: "welfare", label: "ผู้รับบริการสวัสดิการ" },
  { key: "elderly", label: "ผู้รับบริการสูงอายุ" },
  { key: "child", label: "ผู้รับบริการเด็ก" },
  { key: "bed", label: "ผู้รับบริการเตียง/รถเข็น" },
  { key: "smc_checkup", label: "ผู้รับบริการตรวจสุขภาพ SMC" },
  { key: "smc_general", label: "ผู้รับบริการทั่วไป SMC" },
  { key: "smc_elderly", label: "ผู้รับบริการสูงอายุ/รถเข็น SMC" },
  { key: "specimen", label: "ส่งสิ่งส่งตรวจ" },
  { key: "staff", label: "ผู้รับบริการตรวจสุขภาพบุคลากร" },
] as const;

export type PatientCategoryKey = (typeof PATIENT_CATEGORIES)[number]["key"] | "other";
export const OTHER_CATEGORY = { key: "other" as const, label: "อื่น ๆ (ยังไม่จัดกลุ่ม)" };

/** "ทั่วไป (OPD)" -> "ทั่วไป": the trailing "(จุด)" tag on each type name. */
function baseType(type: string): string {
  return type.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

const OPD_KW_TYPES: Record<string, PatientCategoryKey> = {
  "ทั่วไป": "general",
  "สวัสดิการ": "welfare",
  "สูงอายุ": "elderly",
  "เด็ก": "child",
  "รถเข็น/เตียง": "bed",
  "เตียง/รถเข็น": "bed",
  "ส่งสิ่งส่งตรวจ": "specimen",
};

const SMC_TYPES: Record<string, PatientCategoryKey> = {
  "ตรวจสุขภาพ": "smc_checkup",
  "ทั่วไป": "smc_general",
  "สูงอายุ/รถเข็น": "smc_elderly",
  "ส่งสิ่งส่งตรวจ": "specimen",
};

/** Which group one raw (จุดบริการ, ประเภท) row belongs to. */
export function patientCategoryOf(point: string, type: string): PatientCategoryKey {
  if (point.includes("เวชกรรม")) return "staff";
  const base = baseType(type);
  if (point.includes("SMC")) return SMC_TYPES[base] ?? "other";
  if (point.includes("OPD") || point.includes("กว.")) return OPD_KW_TYPES[base] ?? "other";
  return "other";
}

export type CategoryCounts = Record<PatientCategoryKey, number>;

function emptyCounts(): CategoryCounts {
  const c = { other: 0 } as CategoryCounts;
  for (const cat of PATIENT_CATEGORIES) c[cat.key] = 0;
  return c;
}

/** Fiscal-year (Oct..Sep) breakdown: for each month, the count per group,
 * that month's total, and whether the month has any data at all (so an
 * unentered month shows "-", not 0). `yearTotals` sums the whole year. */
export function patientCategoriesByMonth(records: RecordRow[], fiscalYear: number) {
  const fy = fiscalYearMonths(fiscalYear);
  const labels = [MONTH_ABBR_TH[9], MONTH_ABBR_TH[10], MONTH_ABBR_TH[11], ...MONTH_ABBR_TH.slice(0, 9)];
  const months = fy.map(({ year, month }, i) => ({
    label: labels[i],
    year,
    month,
    counts: emptyCounts(),
    total: 0,
    hasData: false,
  }));
  const index = new Map(fy.map(({ year, month }, i) => [`${year}-${month}`, i]));
  const unmatched = new Set<string>();

  for (const r of records) {
    const i = index.get(`${r.year}-${r.month}`);
    if (i == null) continue;
    const key = patientCategoryOf(r.point, r.type);
    if (key === "other" && r.count > 0) unmatched.add(`${r.point} · ${r.type}`);
    const m = months[i];
    m.counts[key] += r.count;
    m.total += r.count;
    m.hasData = true;
  }

  const yearTotals = emptyCounts();
  let yearTotal = 0;
  for (const m of months) {
    for (const k of Object.keys(m.counts) as PatientCategoryKey[]) yearTotals[k] += m.counts[k];
    yearTotal += m.total;
  }

  return {
    months,
    yearTotals,
    yearTotal,
    /** Raw "จุด · ประเภท" names that fell into "other" — shown as a warning. */
    unmatched: Array.from(unmatched).sort(),
    hasOther: yearTotals.other > 0,
  };
}
