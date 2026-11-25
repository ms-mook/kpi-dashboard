"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell, LabelList,
} from "recharts";

export type ComplaintCountRow = {
  month: string;
  /** Complaints received that month; null = month not entered. */
  total: number | null;
  /** How many of them were resolved. */
  resolved: number | null;
  /** Same month, previous fiscal year (for the YoY comparison bars). */
  totalPrev: number | null;
};

type ChartColors = {
  tooltip: React.CSSProperties;
  axisTick: string;
  grid: string;
  cursor: string;
};

/** Monthly complaint COUNTS as bars instead of the "% resolved" line: green
 * when every complaint that month was resolved, red when some are still
 * open. Months with no complaints have no bar — unlike the % line, which
 * drew those as "100%" and hid the months that actually had complaints. */
export function ComplaintCountChart({
  data,
  showPrev,
  label,
  prevLabel,
  colors,
}: {
  data: ComplaintCountRow[];
  showPrev: boolean;
  label: string;
  prevLabel: string;
  colors: ChartColors;
}) {
  const entered = data.filter((d) => d.total != null);
  const yearTotal = entered.reduce((s, d) => s + (d.total ?? 0), 0);
  const yearResolved = entered.reduce((s, d) => s + Math.min(d.resolved ?? 0, d.total ?? 0), 0);
  const open = yearTotal - yearResolved;
  const max = Math.max(2, ...data.map((d) => d.total ?? 0), ...(showPrev ? data.map((d) => d.totalPrev ?? 0) : []));

  return (
    <>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barCategoryGap="28%" margin={{ top: 14, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 13, fill: colors.axisTick }} axisLine={false} tickLine={false} />
          <YAxis
            allowDecimals={false}
            domain={[0, max]}
            width={28}
            tick={{ fontSize: 13, fill: colors.axisTick }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: colors.cursor }}
            contentStyle={colors.tooltip}
            labelStyle={{ color: colors.tooltip.color }}
            formatter={(value, name, item) => {
              if (name === prevLabel) return [value == null ? "ไม่มีข้อมูล" : `${value} ครั้ง`, name];
              const row = item?.payload as ComplaintCountRow | undefined;
              if (!row || row.total == null) return ["ไม่มีข้อมูล", name];
              const resolved = row.resolved ?? 0;
              const text =
                row.total === 0
                  ? "ไม่มีข้อร้องเรียน"
                  : `${row.total} ครั้ง · แก้ไขแล้ว ${Math.min(resolved, row.total)}`;
              return [text, name];
            }}
          />
          {showPrev && <Legend wrapperStyle={{ fontSize: 12, color: colors.axisTick }} />}
          {showPrev && (
            <Bar dataKey="totalPrev" name={prevLabel} fill={colors.axisTick} fillOpacity={0.35} radius={[4, 4, 0, 0]} />
          )}
          <Bar dataKey="total" name={label} radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={
                  d.total != null && d.total > 0 && (d.resolved ?? 0) < d.total
                    ? "var(--color-error)"
                    : "var(--color-success)"
                }
              />
            ))}
            <LabelList
              dataKey="total"
              position="top"
              style={{ fontSize: 13, fontWeight: 600, fill: colors.axisTick }}
              formatter={(v: unknown) => (typeof v === "number" && v > 0 ? v : "")}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 text-center text-[13px] text-base-content/82">
        {entered.length === 0
          ? "ยังไม่มีข้อมูล"
          : yearTotal === 0
            ? `ไม่มีข้อร้องเรียน (${entered.length} เดือนที่กรอกแล้ว)`
            : `รวม ${yearTotal} ครั้ง · แก้ไขแล้ว ${yearResolved} ครั้ง${open > 0 ? ` · ค้าง ${open} ครั้ง` : ""} (เป้าหมาย: แก้ไขครบ 100%)`}
      </div>
    </>
  );
}
