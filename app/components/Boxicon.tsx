// Inline boxicon renderer. Icons come from @boxicons/core as raw 24x24 SVG
// markup (see ../lib/boxicons-data.ts, generated from the package). We render
// them inline with fill="currentColor" so each icon inherits the color of the
// surrounding button/text and works in both light and dark mode.
import type { CSSProperties } from "react";
import { BOXICON_MARKUP, type BoxiconName } from "../lib/boxicons-data";

export default function Boxicon({
  name,
  size = 18,
  style,
  className,
}: {
  name: BoxiconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flex: "none", verticalAlign: "-.15em", ...style }}
      dangerouslySetInnerHTML={{ __html: BOXICON_MARKUP[name] }}
    />
  );
}

export type { BoxiconName };
