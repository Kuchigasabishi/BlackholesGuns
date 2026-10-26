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

/** Semi-automatic pistol in profile, barrel to the right: slide with sights, frame, trigger guard and a raked grip. */
export const GunIcon = () => (
  <Svg name="GUN">
    <path d="M3.5 7h16.2a1 1 0 0 1 1 1v3.6H3.5z" />
    <path d="M20.7 9.3h1.3" />
    <path d="M4.8 7V5.8h1.7V7M18.2 7V5.9h1.3V7" />
    <path d="M7.2 8.6v1.6M9 8.6v1.6M10.8 8.6v1.6" />
    <path d="M3.5 11.6h8.4l1.1 1.1" />
    <path d="M7.4 11.6l-1.7 8.4h4.3l1.6-6.9" />
    <path d="M12.6 12.2v1.9a1.5 1.5 0 0 0 1.5 1.5h1.9" />
    <path d="M12.9 12.6l-.1 1.7" />
  </Svg>
);

/** Chef's kitchen knife: flat spine, wide blade tapering to a point, riveted handle scale. */
export const KitchenKnifeIcon = () => (
  <Svg name="KNIFE">
    <path d="M8.6 8.2h12.6L19.4 12c-.9 2.2-3 3.9-5.6 3.9H8.6z" />
    <path d="M10.4 13.2h5.2" />
    <rect x="1.8" y="8.4" width="6.8" height="7.2" rx="1.4" />
    <circle cx="3.9" cy="12" r="0.7" fill="currentColor" />
    <circle cx="6.5" cy="12" r="0.7" fill="currentColor" />
  </Svg>
);

/**
 * Stacked mirror frames: `n` rounded mirrors layered diagonally (1 to 4), the front one carrying diagonal gloss lines.
 * Every count shares the same 24x24 box, so the four Reflect buttons line up.
 */
export const ReflectIcon = ({ n, name }: { n: 1 | 2 | 3 | 4; name: string }) => {
  const w = 10.5;
  const h = 13;
  const r = 3;
  const step = n === 1 ? 0 : [0, 0, 5, 3.6, 2.8][n]!;
  const span = step * (n - 1);
  const x0 = (24 - w - span) / 2;
  const y0 = (24 - h - span) / 2;
  const frames = Array.from({ length: n }, (_, i) => ({ x: x0 + i * step, y: y0 + i * step }));
  const front = frames[n - 1]!;
  return (
    <Svg name={name}>
      {frames.slice(0, -1).map((f, i) => (
        // a back frame shows only the edges the next one does not cover (like a fanned stack of cards)
        <path key={i} d={`M${f.x + w} ${f.y + step}V${f.y + r}a${r} ${r} 0 0 0-${r}-${r}H${f.x + r}a${r} ${r} 0 0 0-${r} ${r}V${f.y + h - r}a${r} ${r} 0 0 0 ${r} ${r}H${f.x + step}`} />
      ))}
      <rect x={front.x} y={front.y} width={w} height={h} rx={r} />
      <path d={`M${front.x + 2.6} ${front.y + h * 0.62}L${front.x + w * 0.62} ${front.y + 2.8}M${front.x + 2.6} ${front.y + h * 0.84}L${front.x + w - 2.8} ${front.y + h * 0.3}`} strokeWidth="1.2" />
    </Svg>
  );
};

export const INLINE_WEAPON_ICON: Readonly<Record<string, () => ReactElement>> = {
  GUN: GunIcon,
  KNIFE: KitchenKnifeIcon,
  GRENADE: GrenadeIcon,
  BOMB: C4Icon,
  MJOLNIR: MjolnirIcon,
  REFLECT: () => <ReflectIcon n={1} name="REFLECT" />,
  DOUBLE_REFLECT: () => <ReflectIcon n={2} name="DOUBLE_REFLECT" />,
  TRIPLE_REFLECT: () => <ReflectIcon n={3} name="TRIPLE_REFLECT" />,
  QUAD_REFLECT: () => <ReflectIcon n={4} name="QUAD_REFLECT" />,
};
