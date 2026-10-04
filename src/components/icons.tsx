/** Small stroke icons (16px grid) used next to words in toolbars, menus and tables. 3D icons stay in Icon3D. */
import type { SVGProps } from "react";

const PATHS = {
  plus: "M12 5v14M5 12h14",
  import: "M12 3v12M7 10l5 5 5-5M4 19h16",
  export: "M12 15V3M7 8l5-5 5 5M4 19h16",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14v6h-3",
  withdraw: "M7 17 17 7M8 7h9v9",
  disperse: "M4 12h6M14 6h6M14 12h6M14 18h6M10 12l4-6M10 12l4 6",
  consolidate: "M4 6h6M4 12h6M4 18h6M14 12h6M10 6l4 6M10 18l4-6",
  transfer: "M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4",
  sound: "M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14",
  mute: "M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6",
  copy: "M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10",
  check: "m5 13 4 4L19 7",
  x: "M18 6 6 18M6 6l12 12",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-.8",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pause: "M8 5v14M16 5v14",
  play: "M7 5v14l12-7z",
  stop: "M6 6h12v12H6z",
  refresh: "M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4M4 4v5h5M20 20v-5h-5",
  archive: "M3 5h18v4H3zM5 9v11h14V9M10 13h4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  warning: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01",
  zap: "M13 2 4 14h7l-1 8 9-12h-7z",
  wallet: "M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7V5a2 2 0 0 1 2-2h11v4M16 13h5v4h-5a2 2 0 0 1 0-4z",
  rocket: "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15 5 11c1-3 3-6 6-8 3-2 8-1 8-1s1 5-1 8c-2 3-5 5-8 6zM14 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  chart: "M4 20V4M4 20h16M8 16l4-5 3 3 5-7",
  edit: "M4 20h4l10-10-4-4L4 16zM13 7l4 4",
  users: "M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM22 19v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  tag: "M3 3h8l10 10-8 8L3 11zM8 8h.01",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  drop: "M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z",
  clock: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  sliders: "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M14 4v4M6 10v4M16 16v4",
} as const;

export type IconKind = keyof typeof PATHS;

export function Icon({ name, size = 16, className, ...rest }: SVGProps<SVGSVGElement> & { name: IconKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={["shrink-0", className ?? ""].join(" ")}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
