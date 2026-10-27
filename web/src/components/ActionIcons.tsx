import type { ReactElement } from 'react';

/**
 * The six cyberpunk action icons from the Figma "Action icons" frames, rebuilt as inline vector geometry.
 * Every stroke and fill is `currentColor`: the Figma cyan is the full colour, the magenta accents and the white
 * highlights are the same colour at reduced opacity, so one text colour (or opacity / grayscale on an unaffordable
 * button) restyles the whole glyph. The only fixed colour is the dark cutout in the pistol's power cell, which can be
 * themed with `--icon-cut`. Geometry is authored on the Figma 240 x 240 frame, so every icon shares one bounding box.
 * Generated from the Figma nodes (Dodge 35:3, Shield 35:21, Charge 35:35, Gun 49:3, Knife 49:19, Reflect 49:35).
 */
export type ActionIconName = 'DODGE' | 'SHIELD' | 'CHARGE' | 'GUN' | 'KNIFE' | 'REFLECT';

function Frame({ name, children }: { name: string; children: ReactElement }): ReactElement {
  return (
    <svg data-action-icon={name} viewBox="12 12 216 216" fill="none" aria-hidden="true" focusable="false" className="block size-full overflow-visible">
      {children}
    </svg>
  );
}

const DODGE = (
  <Frame name="DODGE">
    <g>
        <g transform="translate(22.01 100.01) scale(1 0.89)">
          <path d="M10 2.5H47" strokeWidth="5" stroke="currentColor" opacity=".6" />
          <path d="M0 22.5H34" strokeWidth="5" stroke="currentColor" opacity=".6" />
          <path d="M12 42.5H39" strokeWidth="5" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(50.45 85.08)">
          <path d="M37.5375 1.91809L18.5375 30.9181L20.2582 32.2647M62.5375 85.9181L41.5375 48.9181L20.2582 32.2647M20.2582 32.2647L21.5375 30.9181M20.2582 32.2647L2.5375 50.9181M41.5375 48.9181L24.5375 82.9181" strokeWidth="7" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(124.99 58.01)">
          <path d="M10 0L20 6V19L10 25L0 19V6L10 0Z" fill="currentColor" opacity=".85" />
          <path d="M6 11H16" strokeWidth="3" stroke="currentColor" />
        </g>
        <g transform="translate(84.64 78.17)">
          <path d="M31.3743 10.8325L51.3743 17.8325L34.3743 48.8325L13.3743 38.8325L31.3743 10.8325Z" fill="currentColor" />
          <path d="M31.3743 11.8325L18.3743 3.83246L3.37427 20.8325M45.3743 21.8325L62.3743 33.8325L82.3743 18.8325" strokeWidth="9" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(82.62 118.72)">
          <path d="M23.3841 3.2681L4.38406 25.2681L21.3841 56.2681H38.3841" strokeWidth="10" strokeLinejoin="bevel" stroke="currentColor" />
          <path d="M37.3841 7.2681L58.3841 22.2681L41.3841 55.2681" strokeWidth="10" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(183.22 101.24)">
          <path d="M1.76777 1.76777L18.7678 18.7678L1.76777 35.7678" strokeWidth="5" stroke="currentColor" opacity=".6" />
        </g>
    </g>
  </Frame>
);

const SHIELD = (
  <Frame name="SHIELD">
    <g>
        <g transform="translate(61.51 50.68)">
          <path d="M58.5 2.31255L114.5 25.3125V70.3125L98.5 100.313L58.5 129.313L18.5 100.313L2.5 70.3125V25.3125L58.5 2.31255Z" fill="currentColor" fillOpacity="0.08" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(79.99 70.01)">
          <path d="M40 0L80 17V48L67 71L40 91L13 71L0 48V17L40 0Z" fill="currentColor" fillOpacity="0.09" />
          <path d="M40 5V37M40 37V85M40 37L9 24M40 37L71 24" strokeWidth="3" stroke="currentColor" />
        </g>
        <g transform="translate(109.99 103.99)">
          <path d="M10 0L20 10L10 20L0 10L10 0Z" fill="currentColor" opacity=".85" />
        </g>
        <g transform="translate(50.01 82.99)">
          <path d="M2 0V41L18 72" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(170.23 82.99)">
          <path d="M17.7772 0V41L1.77724 72" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(71.51 73.6)">
          <path d="M1.5 18.398V8.39801L19.5 1.39801M77.5 81.398L85.5 75.398L96.5 55.398" strokeWidth="3" stroke="currentColor" opacity=".85" />
        </g>
    </g>
  </Frame>
);

const CHARGE = (
  <Frame name="CHARGE">
    <g>
        <g transform="translate(62.99 56.99)">
          <path d="M23 2H2V25M91 124H112V101" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(50.49 100.01)">
          <path d="M2.5 0V13M2.5 22V35M2.5 44V57" strokeWidth="5" stroke="currentColor" />
        </g>
        <g transform="translate(184.51 82.99)">
          <path d="M2.5 0V13M2.5 22V35M2.5 44V57" strokeWidth="5" stroke="currentColor" />
        </g>
        <g transform="translate(75.97 46.5)">
          <path d="M58.0308 2.5L2.03081 80.5H38.0308L25.0308 142.5L88.0308 61.5H51.0308L65.0308 2.5H58.0308Z" fill="currentColor" fillOpacity="0.12" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(96 76.99)">
          <path d="M33 0L0 42H30L21 82L51 39H23L33 0Z" fill="currentColor" opacity=".85" />
        </g>
        <g transform="translate(70.5 52.59)">
          <path d="M90.4948 10.4142L99.4948 1.41421M1.49482 125.414L9.49482 116.414" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
    </g>
  </Frame>
);

const GUN = (
  <Frame name="GUN">
    <g>
        <g transform="translate(46.51 64.51)">
          <path d="M7.5 14.5L19.5 2.5H127.5L140.5 14.5V44.5H67.5L59.5 57.5H43.5L57.5 108.5H26.5L11.5 57.5H2.5V23.5L7.5 14.5Z" fill="currentColor" fillOpacity="0.12" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(69 77.01)">
          <path d="M0 2H102V12H49" strokeWidth="4" stroke="currentColor" opacity=".85" />
        </g>
        <g transform="translate(192.5 81)">
          <path d="M2.5 0V22M12.5 7V15" strokeWidth="5" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(73.01 94.01)">
          <path d="M0 0H26V11H0V0Z" fill="currentColor" />
          <path d="M8 0V11M18 0V11" strokeWidth="2" stroke="var(--icon-cut, #02050A)" />
        </g>
        <g transform="translate(99 116.01)">
          <path d="M0 2H28V12L19 24H0M13 3L10 13" strokeWidth="4" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(73.99 131.01)">
          <path d="M0 2H11M3 13H14M6 24H17" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(68.01 56.01)">
          <path d="M2 8V2H15M94 8V2H104" strokeWidth="4" stroke="currentColor" />
        </g>
    </g>
  </Frame>
);

const KNIFE = (
  <Frame name="KNIFE">
    <g>
        <g transform="translate(100.89 49.71)">
          <path d="M2.11798 78.3008L39.118 19.3008L79.118 2.30083L64.118 53.3008L25.118 99.3008L2.11798 78.3008Z" fill="currentColor" fillOpacity="0.12" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(120.48 59.09)">
          <path d="M55.5127 0.910952L33.5127 43.911L1.51273 80.911" strokeWidth="4" stroke="currentColor" opacity=".85" />
        </g>
        <g transform="translate(118.85 86.04)">
          <path d="M1.15233 36.9603L31.1523 0.960277" strokeWidth="3" stroke="currentColor" />
        </g>
        <g transform="translate(88.02 118.78)">
          <path d="M3.99238 0.213741L2.99238 14.2137L37.9924 44.2137L51.9924 41.2137" strokeWidth="6" strokeLinejoin="bevel" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(65.27 141.1)">
          <path d="M35.7412 1.88922L50.7412 14.8892L17.7412 48.8892L1.74119 34.8892L35.7412 1.88922Z" fill="currentColor" fillOpacity="0.12" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" />
          <path d="M25.7412 13.8892L38.7412 24.8892M17.7412 22.8892L30.7412 33.8892" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(61.63 176.55)">
          <path d="M1.36788 1.45907L17.3679 16.4591" strokeWidth="4" stroke="currentColor" opacity=".85" />
        </g>
        <g transform="translate(146.25 35.04)">
          <path d="M1.75579 11.9577L7.75579 0.957704M45.7558 40.9577L57.7558 36.9577" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
    </g>
  </Frame>
);

const REFLECT = (
  <Frame name="REFLECT">
    <g>
        <g transform="translate(134.49 50.2)">
          <path d="M14.5 1.8125L34.5 20.8125V114.812L14.5 137.812L2.5 115.812V23.8125L14.5 1.8125Z" fill="currentColor" fillOpacity="0.12" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(149.01 76.01)">
          <path d="M2 0V88" strokeWidth="4" stroke="currentColor" opacity=".85" />
        </g>
        <g transform="translate(47.7 62.86)">
          <path d="M1.30491 2.13242L68.3049 43.1324M45.3049 42.1324L68.3049 43.1324L51.3049 22.1324" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" opacity=".6" />
        </g>
        <g transform="translate(52.55 124.92)">
          <path d="M73.4597 2.08463L2.45967 49.0846M25.4597 48.0846L2.45967 49.0846L6.45967 27.0846" strokeWidth="5" strokeLinejoin="bevel" stroke="currentColor" />
        </g>
        <g transform="translate(129 109.01)">
          <path d="M8 0L16 8L8 16L0 8L8 0Z" fill="currentColor" opacity=".85" />
        </g>
        <g transform="translate(105 90.28)">
          <path d="M13 28.7285H0M21 9.72846L16 0.728464M21 46.7285L16 55.7285" strokeWidth="3" stroke="currentColor" />
        </g>
        <g transform="translate(179.01 82.01)">
          <path d="M2 0V23M2 51V74M13 25V50" strokeWidth="4" stroke="currentColor" opacity=".6" />
        </g>
    </g>
  </Frame>
);

/** Icon element per action id. */
export const ACTION_ICON: Readonly<Record<ActionIconName, ReactElement>> = { DODGE, SHIELD, CHARGE, GUN, KNIFE, REFLECT };

const ICON_FOR_EMOJI: Readonly<Record<string, ActionIconName>> = { '⚡': 'CHARGE', '💨': 'DODGE', '🛡️': 'SHIELD', '🔫': 'GUN', '🔪': 'KNIFE', '🪞': 'REFLECT' };

/** The Figma icon for an action's emoji, or null for actions that have none (the heavier weapons keep their emoji). */
export function iconNameForEmoji(emoji: string): ActionIconName | null {
  const base = [...emoji][0] === '🪞' ? '🪞' : emoji;
  return ICON_FOR_EMOJI[base] ?? null;
}

/** One action icon in a square box of the caller's size (`className` should set `size-*`); it fills the box and never reflows. */
export function ActionIcon({ name, className = 'size-full' }: { name: ActionIconName; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-block shrink-0 ${className}`}>
      {ACTION_ICON[name]}
    </span>
  );
}

/**
 * An action's symbol: the Figma vector icon for Charge, Dodge, Shield, Gun, Knife and Reflect (the Reflect tier shows as a
 * small ×n), the plain emoji for the remaining weapons. While `trigger` is false (a defense waiting for the projectile to
 * land) the icon is held back at low opacity; it lights up at the impact moment.
 */
export function ActionGlyph({ emoji, trigger = true, className = 'size-full' }: { emoji: string; trigger?: boolean; className?: string }) {
  const name = iconNameForEmoji(emoji);
  if (!name) return <>{emoji}</>;
  const times = name === 'REFLECT' ? emoji.split('×')[1] : undefined;
  return (
    <span data-glyph={name} data-lit={trigger} className={`inline-flex items-center justify-center gap-1 transition-opacity duration-150 ${trigger ? '' : 'opacity-30'}`}>
      <ActionIcon name={name} className={className} />
      {times && <span className="font-plex text-[0.35em] font-bold leading-none">×{times}</span>}
    </span>
  );
}
