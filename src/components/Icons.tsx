import type { ReactNode, SVGProps } from 'react';

/**
 * Hand-tuned 24×24 stroke icon set (Lucide-style geometry, no runtime deps).
 * Every icon is decorative by default (aria-hidden) — keep the visible text
 * label next to it so accessible names and E2E text selectors stay intact.
 */
export type IconName =
  | 'home'
  | 'pen'
  | 'bookX'
  | 'star'
  | 'starFill'
  | 'book'
  | 'sun'
  | 'moon'
  | 'target'
  | 'circleDot'
  | 'checkSquare'
  | 'scale'
  | 'fileText'
  | 'network'
  | 'download'
  | 'upload'
  | 'trash'
  | 'search'
  | 'x'
  | 'clock'
  | 'arrowLeft'
  | 'arrowRight'
  | 'shield'
  | 'check'
  | 'circleCheck'
  | 'circleHelp'
  | 'circleX'
  | 'grid'
  | 'layers'
  | 'sparkles'
  | 'chevronRight';

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" />
      <path d="M9.75 21v-6h4.5v6" />
    </>
  ),
  pen: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  bookX: (
    <>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="m10 7 4.5 4.5m0-4.5L10 11.5" />
    </>
  ),
  star: <path d="M12 2.8l2.84 5.76 6.36.92-4.6 4.48 1.08 6.33L12 17.3l-5.68 2.99 1.08-6.33-4.6-4.48 6.36-.92Z" />,
  starFill: (
    <path
      d="M12 2.8l2.84 5.76 6.36.92-4.6 4.48 1.08 6.33L12 17.3l-5.68 2.99 1.08-6.33-4.6-4.48 6.36-.92Z"
      fill="currentColor"
    />
  ),
  book: (
    <>
      <path d="M2 4.5h6a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H2Z" />
      <path d="M22 4.5h-6a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h7Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  moon: <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7Z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.25" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  circleDot: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </>
  ),
  checkSquare: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="m8 12.2 2.8 2.8L16.5 9" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3.5v17" />
      <path d="M8 20.5h8" />
      <path d="M4.5 7h15" />
      <path d="m4.5 7-2.75 6.25a2.75 2.75 0 0 0 5.5 0Z" />
      <path d="m19.5 7-2.75 6.25a2.75 2.75 0 0 0 5.5 0Z" />
    </>
  ),
  fileText: (
    <>
      <path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9Z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  network: (
    <>
      <circle cx="5.5" cy="6" r="2.5" />
      <circle cx="18.5" cy="6" r="2.5" />
      <circle cx="12" cy="18.5" r="2.5" />
      <path d="M8 6h8M7 8.2l3.7 8M17 8.2l-3.7 8" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="m6 7 .9 12.2A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.8L18 7" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.75" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  x: <path d="M17.5 6.5l-11 11M6.5 6.5l11 11" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  arrowLeft: <path d="M19 12H5M11 18l-6-6 6-6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  shield: (
    <>
      <path d="M12 3 4.5 6v5.6c0 4.6 3.2 8.1 7.5 9.4 4.3-1.3 7.5-4.8 7.5-9.4V6Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.2 12.2 2.6 2.6 5-5.3" />
    </>
  ),
  circleHelp: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.25c-.7.35-1.2.95-1.2 1.75v.2" />
      <path d="M12 16.8h.01" />
    </>
  ),
  circleX: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m14.8 9.2-5.6 5.6M9.2 9.2l5.6 5.6" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.75" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5 13.6 8.4 18.5 10l-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6Z" />
      <path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" />
    </>
  ),
  chevronRight: <path d="m9 6 6 6-6 6" />,
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, strokeWidth = 1.9, className, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`icon${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
