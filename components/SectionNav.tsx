"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";

export type SectionNavItem = { id: string; label: string; icon: LucideIcon };

/** How far below the top of the viewport a section's anchor must have
 * scrolled before it counts as "the section you're reading" — just under
 * the sticky bar itself. */
const SPY_OFFSET_PX = 140;

/** Sticky in-page navigation: one pill per dashboard section, the current
 * section highlighted as you scroll (scroll-spy). Labels never wrap — on a
 * narrow screen the bar scrolls sideways instead and keeps the active pill
 * centered in view. Each target element needs a matching `id` and a
 * `scroll-mt-*` class so it lands below this bar rather than under it. */
export function SectionNav({ items }: { items: SectionNavItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  // After a click the page is smooth-scrolling past other sections; don't
  // let the spy flicker through them on the way.
  const lockUntil = useRef(0);
  const ids = items.map((i) => i.id).join("|");

  useEffect(() => {
    const sectionIds = ids.split("|").filter(Boolean);
    if (!sectionIds.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < lockUntil.current) return;
      const els = sectionIds
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el != null);
      if (!els.length) return;
      const doc = document.documentElement;
      // At the very bottom the last (often short) section can never reach
      // the offset line, so treat "scrolled to the end" as being on it.
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
        setActive(els[els.length - 1].id);
        return;
      }
      let current = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= SPY_OFFSET_PX) current = el.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  // Keep the active pill visible when the bar is wider than the screen.
  useEffect(() => {
    const list = listRef.current;
    if (!active || !list || list.scrollWidth <= list.clientWidth) return;
    const el = list.querySelector<HTMLElement>(`[data-sec="${active}"]`);
    if (!el) return;
    list.scrollTo({ left: el.offsetLeft - (list.clientWidth - el.clientWidth) / 2, behavior: "smooth" });
  }, [active]);

  function go(e: MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    setActive(id);
    lockUntil.current = Date.now() + 900;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  }

  if (!items.length) return null;

  return (
    <nav aria-label="ไปยังส่วนต่าง ๆ ของหน้า" className="sticky top-2 z-30 mb-6 print:hidden">
      <div
        ref={listRef}
        className="glass-panel relative flex gap-1 overflow-x-auto rounded-box p-1.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ id, label, icon: Icon }) => {
          const on = active === id;
          return (
            <a
              key={id}
              href={`#${id}`}
              data-sec={id}
              onClick={(e) => go(e, id)}
              aria-current={on ? "location" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-field px-3 py-2 text-[13px] font-medium transition-colors sm:text-sm ${
                on
                  ? "bg-primary/15 text-primary"
                  : "text-base-content/60 hover:bg-base-content/5 hover:text-base-content"
              }`}
            >
              <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
              {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
