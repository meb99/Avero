// Small stroke icons drawn on a 20×20 grid, colored with currentColor.
import type { ReactNode } from "react";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const OpenIcon = () => (
  <Icon>
    <path d="M2.5 6.5v8.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H9.5L8 5H3.5a1 1 0 0 0-1 1.5z" />
  </Icon>
);

export const FlipIcon = () => (
  <Icon>
    <path d="M10 2.5v15" strokeDasharray="1.5 2" />
    <path d="M7.5 5.5 3 14.5h4.5z" />
    <path d="M12.5 5.5l4.5 9h-4.5z" fill="currentColor" fillOpacity="0.25" />
  </Icon>
);

export const RotateIcon = () => (
  <Icon>
    <path d="M15.5 9.5a5.5 5.5 0 1 1-2-4.25" />
    <path d="M14 2.5v3.25h-3.25" />
  </Icon>
);

export const FitIcon = () => (
  <Icon>
    <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
    <rect x="6.5" y="6.5" width="7" height="7" rx="1" />
  </Icon>
);

export const ZoomInIcon = () => (
  <Icon>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M12.5 12.5 17 17M6 8.5h5M8.5 6v5" />
  </Icon>
);

export const ZoomOutIcon = () => (
  <Icon>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M12.5 12.5 17 17M6 8.5h5" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
  </Icon>
);

export const HelpIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4v.4" />
    <circle cx="10" cy="14.3" r="0.4" fill="currentColor" />
  </Icon>
);

export const CloseIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 5l10 10M15 5 5 15" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon size={16}>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M12.5 12.5 17 17" />
  </Icon>
);

export const ChipIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="5" y="5" width="10" height="10" rx="1.5" />
    <path d="M8 2.5V5M12 2.5V5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5" />
  </Icon>
);

export const NetIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="4.5" cy="10" r="2" />
    <circle cx="15.5" cy="5" r="2" />
    <circle cx="15.5" cy="15" r="2" />
    <path d="M6.5 10h4l3-4.2M10.5 10l3 4.2" />
  </Icon>
);

export const PinIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="10" cy="10" r="4" />
    <circle cx="10" cy="10" r="1.2" fill="currentColor" />
  </Icon>
);
