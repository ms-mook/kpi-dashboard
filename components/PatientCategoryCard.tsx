"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Users, AlertTriangle } from "lucide-react";
import type { RecordRow } from "@/lib/aggregate";
import {
  PATIENT_CATEGORIES, OTHER_CATEGORY, patientCategoriesByMonth, type PatientCategoryKey,
} from "@/lib/patient-categories";
import { BentoCard } from "@/components/BentoCard";

type ChartColors = { tooltip: React.CSSProperties; axisTick: string; grid: string; cursor: string };
type Mode = "count" | "pct";

const BAR = "var(--color-primary)";
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** ประเภทผู้รับบริการ: 10 groups compared by count and by % of all patients.
 *
 * Deliberately NOT one 10-colour stacked bar: past ~8 colours segments can't
 * be told apart, and the small groups (~2%) become slivers a few pixels tall
 * on a phone. Instead: (1) ranked bars to compare the groups for the chosen
 * scope, (2) one small single-colour bar chart per group for month-to-month,
 * and (3) the exact numbers in a table. */
export function PatientCategoryCard({
  records,
  fiscalYear,
  monthIndex,
  colors,
  i = 0,
}: {
  records: RecordRow[];
  fiscalYear: number;
  /** "all" = whole fiscal year; 0..11 = fiscal-order month (0 = ต.ค.). */
  monthIndex: number | "all";
  colors: ChartColors;
  i?: number;
}) {
  const [mode, setMode] = useState<Mode>("count");
  const data = useMemo(() => patientCategoriesByMonth(records, fiscalYear), [records, fiscalYear]);

  const cats: { key: PatientCategoryKey; label: string }[] = [
    ...PATIENT_CATEGORIES,
    ...(data.hasOther ? [OTHER_CATEGORY] : []),
  ];

  const selected = monthIndex === "all" ? null : data.months[monthIndex];
  const scopeCounts = selected ? selected.counts : data.yearTotals;
  const scopeTotal = selected ? selected.total : data.yearTotal;
  const scopeLabel = selected ? `เดือน ${selected.label} ${selected.year}` : `ปีงบ ${fiscalYear}`;
  const ranked = [...cats].sort((a, b) => scopeCounts[b.key] - scopeCounts[a.key]);
  const maxCount = Math.max(1, ...cats.map((c) => scopeCounts[c.key]));
  const filled = data.months.filter((m) => m.hasData).length;

  return (
    <BentoCard i={i} id="sec-types" className="scroll-mt-24 !p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="icon-badge flex h-7 w-7 items-center justify-center rounded-field bg-primary/15 text-primary">
            <Users size={14} strokeWidth={2.2} />
          </span>
          <h2 className="text-sm font-semibold text-base-content">ประเภทผู้รับบริการ</h2>
          <span className="text-xs text-base-content/40">{scopeLabel}</span>
        </div>
        <div className="join" role="group" aria-label="แสดงกราฟรายเดือนเป็น">
          {(["count", "pct"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`btn join-item btn-xs ${mode === m ? "btn-primary" : "btn-ghost bg-base-200/60"}`}
            >
              {m === "count" ? "จำนวน" : "ร้อยละ"}
            </button>
          ))}
        </div>
      </div>

      {data.unmatched.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-field bg-warning/10 px-3 py-2 text-xs text-base-content/70">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>
            มีประเภทที่ยังไม่ได้จัดเข้ากลุ่ม จึงนับไว้ใน &quot;อื่น ๆ&quot;: {data.unmatched.join(", ")}
          </span>
        </div>
      )}

      {scopeTotal === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/40">ยังไม่มีข้อมูลใน{scopeLabel}</p>
      ) : (
        <>
          {/* 1 — compare the groups (ranked, one hue) */}
          <h3 className="mb-2 text-xs font-medium text-base-content/50">
            เปรียบเทียบระหว่างประเภท · รวม {fmt(scopeTotal)} คน
          </h3>
          <div className="space-y-2.5">
            {ranked.map((c) => {
              const n = scopeCounts[c.key];
              return (
                <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3">
                  <span className="truncate text-xs text-base-content/70" title={c.label}>{c.label}</span>
                  <span className="stat-figure-num w-16 text-right text-xs text-base-content/80">{fmt(n)}</span>
                  <span className="stat-figure-num w-12 text-right text-xs font-semibold text-base-content">
                    {pct(n, scopeTotal).toFixed(1)}%
                  </span>
                  <div className="col-span-3 h-1.5 overflow-hidden rounded-full bg-base-content/6">
                    <div className="h-full rounded-full" style={{ width: `${(n / maxCount) * 100}%`, background: BAR }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 2 — month by month, one small chart per group */}
          <h3 className="mb-1 mt-6 text-xs font-medium text-base-content/50">
            รายเดือน ({mode === "count" ? "จำนวนคน" : "ร้อยละของผู้รับบริการทั้งหมดในเดือนนั้น"})
          </h3>
          <p className="mb-3 text-[11px] text-base-content/35">
            แต่ละกราฟใช้สเกลของตัวเอง เพื่อให้เห็นการขึ้นลงของแต่ละประเภท · แตะแท่งเพื่อดูตัวเลข
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {cats.map((c) => {
              const series = data.months.map((m) => ({
                month: m.label,
                value: m.hasData ? (mode === "count" ? m.counts[c.key] : pct(m.counts[c.key], m.total)) : null,
                count: m.counts[c.key],
                share: pct(m.counts[c.key], m.total),
                hasData: m.hasData,
              }));
              const headline = scopeCounts[c.key];
              return (
                <div key={c.key} className="min-w-0 rounded-field border border-base-content/8 bg-base-200/30 p-2.5">
                  <div className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-4 text-base-content/60">
                    {c.label}
                  </div>
                  <div className="stat-figure-num mt-1 text-base font-bold text-base-content">
                    {mode === "count" ? fmt(headline) : `${pct(headline, scopeTotal).toFixed(1)}%`}
                  </div>
                  <ResponsiveContainer width="100%" height={72}>
                    <BarChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="18%">
                      <XAxis
                        dataKey="month"
                        interval="preserveStartEnd"
                        tick={{ fontSize: 9, fill: colors.axisTick }}
                        axisLine={false}
                        tickLine={false}
                        height={14}
                      />
                      <YAxis hide domain={[0, "auto"]} />
                      <Tooltip
                        cursor={{ fill: colors.cursor }}
                        contentStyle={{ ...colors.tooltip, fontSize: 11, padding: "4px 8px" }}
                        labelStyle={{ color: colors.tooltip.color }}
                        formatter={(_v, _n, item) => {
                          const p = item?.payload as (typeof series)[number] | undefined;
                          if (!p || !p.hasData) return ["ไม่มีข้อมูล", ""];
                          return [`${fmt(p.count)} คน (${p.share.toFixed(1)}%)`, ""];
                        }}
                        separator=""
                      />
                      <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {series.map((_, idx) => (
                          <Cell
                            key={idx}
                            fill={BAR}
                            fillOpacity={monthIndex === "all" || monthIndex === idx ? 1 : 0.25}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>

          {/* 3 — exact numbers */}
          <h3 className="mb-2 mt-6 text-xs font-medium text-base-content/50">
            ตารางจำนวน (ร้อยละ) · ปีงบ {fiscalYear} · มีข้อมูล {filled}/12 เดือน
          </h3>
          <div className="overflow-x-auto rounded-field border border-base-content/8">
            <table className="w-full min-w-[960px] text-[11px]">
              <thead>
                <tr className="border-b border-base-content/8 text-base-content/45">
                  <th className="sticky left-0 z-10 bg-base-200 px-2 py-1.5 text-left font-medium">ประเภท</th>
                  {data.months.map((m, idx) => (
                    <th
                      key={m.label}
                      className={`px-1.5 py-1.5 text-right font-medium ${monthIndex === idx ? "bg-primary/10 text-primary" : ""}`}
                    >
                      {m.label}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-semibold text-base-content/70">รวม</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.key} className="border-b border-base-content/5">
                    <td className="sticky left-0 z-10 max-w-[9rem] truncate bg-base-200 px-2 py-1.5 text-base-content/70" title={c.label}>
                      {c.label}
                    </td>
                    {data.months.map((m, idx) => (
                      <td
                        key={m.label}
                        className={`stat-figure-num px-1.5 py-1.5 text-right ${monthIndex === idx ? "bg-primary/10" : ""}`}
                      >
                        {m.hasData ? (
                          <>
                            <div className="text-base-content/85">{fmt(m.counts[c.key])}</div>
                            <div className="text-[10px] text-base-content/40">{pct(m.counts[c.key], m.total).toFixed(1)}%</div>
                          </>
                        ) : (
                          <span className="text-base-content/25">-</span>
                        )}
                      </td>
                    ))}
                    <td className="stat-figure-num px-2 py-1.5 text-right">
                      <div className="font-semibold text-base-content">{fmt(data.yearTotals[c.key])}</div>
                      <div className="text-[10px] text-base-content/40">{pct(data.yearTotals[c.key], data.yearTotal).toFixed(1)}%</div>
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="sticky left-0 z-10 bg-base-200 px-2 py-1.5 text-base-content">รวมทั้งหมด</td>
                  {data.months.map((m, idx) => (
                    <td
                      key={m.label}
                      className={`stat-figure-num px-1.5 py-1.5 text-right text-base-content ${monthIndex === idx ? "bg-primary/10" : ""}`}
                    >
                      {m.hasData ? fmt(m.total) : <span className="font-normal text-base-content/25">-</span>}
                    </td>
                  ))}
                  <td className="stat-figure-num px-2 py-1.5 text-right text-base-content">{fmt(data.yearTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-base-content/35">
            ร้อยละ = จำนวนของประเภทนั้น ÷ ผู้รับบริการทั้งหมดในเดือนเดียวกัน · ประเภท 1–5 รวมห้องเจาะเลือด OPD และ กว. ·
            ส่งสิ่งส่งตรวจรวม OPD, กว. และ SMC · ตรวจสุขภาพบุคลากร = ห้องเจาะเลือดงานเวชกรรมฯ
          </p>
        </>
      )}
    </BentoCard>
  );
}
