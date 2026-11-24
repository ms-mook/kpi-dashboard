"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PATIENT_CATEGORIES, type PatientCategoryKey } from "@/lib/patient-categories";

const ALL_KEYS = PATIENT_CATEGORIES.map((c) => c.key) as PatientCategoryKey[];

/** Multi-select for the 10 ประเภทผู้รับบริการ groups. "all" means no
 * category filter (also keeps any not-yet-grouped "อื่น ๆ" rows); at least
 * one group always stays ticked so the dashboard never goes blank. */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: PatientCategoryKey[] | "all";
  onChange: (v: PatientCategoryKey[] | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = new Set(value === "all" ? ALL_KEYS : value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(key: PatientCategoryKey) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size === 0) return; // keep at least one
    onChange(next.size === ALL_KEYS.length ? "all" : ALL_KEYS.filter((k) => next.has(k)));
  }

  const summary =
    value === "all"
      ? "ทุกประเภท"
      : value.length === 1
        ? PATIENT_CATEGORIES.find((c) => c.key === value[0])?.label.replace("ผู้รับบริการ", "") ?? "1 ประเภท"
        : `${value.length} ประเภท`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="btn btn-sm flex w-auto min-w-[9rem] max-w-[14rem] justify-between gap-2 border border-base-content/20 bg-base-200/60 font-normal text-base-content shadow-none hover:bg-base-200"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
      </button>
      {open && (
        <div className="glass-panel absolute left-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-box p-2 shadow-xl">
          <div className="mb-1 flex items-center justify-between px-2 py-1 text-[11px] text-base-content/50">
            <span>เลือกประเภทที่ต้องการดู</span>
            <button
              type="button"
              className="link link-primary no-underline"
              onClick={() => onChange("all")}
              disabled={value === "all"}
            >
              เลือกทั้งหมด
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {PATIENT_CATEGORIES.map((c) => {
              const on = selected.has(c.key);
              const onlyOne = on && selected.size === 1;
              return (
                <li key={c.key}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-field px-2 py-1.5 text-sm hover:bg-base-content/5 ${
                      onlyOne ? "cursor-not-allowed opacity-70" : ""
                    }`}
                    title={onlyOne ? "ต้องเลือกอย่างน้อย 1 ประเภท" : undefined}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary"
                      checked={on}
                      disabled={onlyOne}
                      onChange={() => toggle(c.key)}
                    />
                    <span className="truncate text-base-content/80">{c.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
