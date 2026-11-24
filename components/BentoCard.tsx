import { ReactNode } from "react";

/** A glass bento tile. `i` controls the staggered load-in delay — pass the
 * tile's index within its grid so cards cascade in reading order. */
export function BentoCard({
  children,
  className = "",
  i = 0,
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  className?: string;
  i?: number;
  as?: "div" | "section";
  /** In-page anchor target (e.g. for SectionNav). */
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={`glass-panel card-hover bento-enter rounded-box p-5 ${className}`}
      style={{ "--bento-i": i } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
