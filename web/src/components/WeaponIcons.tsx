import type { ReactElement } from 'react';

/**
 * Inline weapon glyphs drawn for the control panel (24x24 viewBox, 1.5 stroke). They use `currentColor` only, so the
 * button's text colour and its dimming for unaffordable actions apply to them, and they scale with the 18px icon slot.
 */
const Svg = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-weapon-icon={name}>
    {children}
  </svg>
);

/** Fragmentation grenade: segmented "pineapple" body, spoon lever, fuse neck and a safety-pin ring. */
export const GrenadeIcon = () => (
  <Svg name="GRENADE">
    <path d="M8 11c0-1.8 1.8-3.2 4-3.2s4 1.4 4 3.2v5.6c0 2.1-1.8 3.6-4 3.6s-4-1.5-4-3.6z" />
    <path d="M12 7.8v12.4M8 13.2h8M8.2 16.6h7.6" />
    <path d="M8.6 10l6.8 8.4M15.4 10l-6.8 8.4" />
    <path d="M10.4 7.8V6h3.2v1.8" />
    <path d="M13.6 6.3h2.4a1.4 1.4 0 0 1 1.4 1.4V9" />
    <circle cx="7.4" cy="5" r="1.7" />
    <path d="M9.1 5h1.3" />
  </Svg>
);

/** CS:GO-style C4: explosive brick, digital timer block, keypad grid and exposed wires. */
export const C4Icon = () => (
  <Svg name="BOMB">
    <rect x="2.5" y="7.5" width="19" height="11" rx="1.3" />
    <rect x="4.4" y="9.4" width="8.6" height="4.4" rx="0.6" />
    <path d="M5.9 10.5h1.5v1.1H5.9zM8.1 10.5h1.5v1.1H8.1z" />
    <path d="M10.4 10.6v.1M10.4 12.4v.1" strokeWidth="2" />
    <path d="M11.2 10.5h.9v1.1h-.9z" />
    <path d="M15 9.4h4.6v5.6H15zM16.5 9.4V15M18.1 9.4V15M15 11.3h4.6M15 13.2h4.6" />
    <path d="M4.4 15.9h8.6" strokeDasharray="1.6 1.4" />
    <path d="M6 7.5V5a1.5 1.5 0 0 1 1.5-1.5H11M16.2 7.5V6a1.8 1.8 0 0 1 1.8-1.8H21.5" />
    <path d="M5 18.5v1.2c0 .7.6 1.3 1.3 1.3H12" />
    <circle cx="19.5" cy="16.9" r="0.7" fill="currentColor" />
  </Svg>
);

/** Mjolnir: bevelled stone hammerhead with angular runes, banded grip and a triangular wrist-loop pommel. */
export const MjolnirIcon = () => (
  <Svg name="MJOLNIR">
    <rect x="3" y="3" width="18" height="8.8" rx="1" />
    <rect x="5.3" y="5" width="13.4" height="4.8" rx="0.4" />
    <path d="M3 3l2.3 2M21 3l-2.3 2M3 11.8l2.3-2M21 11.8l-2.3-2" />
    <path d="M8 6.4l1.4 2.6 1.4-2.6M13.2 6.4V9M13.2 7.7h2.2M15.4 6.4V9" />
    <rect x="10.7" y="11.8" width="2.6" height="7.4" />
    <path d="M10.7 14h2.6M10.7 16.3h2.6" />
    <path d="M12 19.2l2.5 3.2H9.5z" />
    <path d="M14.5 22.4c1.3 0 1.8-1.3.9-2" />
  </Svg>
);

export const INLINE_WEAPON_ICON: Readonly<Record<string, () => ReactElement>> = {
  GRENADE: GrenadeIcon,
  BOMB: C4Icon,
  MJOLNIR: MjolnirIcon,
};
