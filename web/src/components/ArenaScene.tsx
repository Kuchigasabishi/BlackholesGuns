import type { ReactNode } from 'react';
import connectionIndicator from '../assets/landing/connection-indicator.svg';
import targetReticle from '../assets/landing/target-reticle.svg';
import glow from '../assets/ui/glow.svg';
import hole from '../assets/ui/hole.svg';
import photon from '../assets/ui/photon.svg';
import unstable from '../assets/ui/unstable.svg';
import gameGrid from '../assets/ui/game-grid.svg';
import gameOrbit1 from '../assets/ui/game-orbit-1.svg';
import gameOrbit2 from '../assets/ui/game-orbit-2.svg';
import lobbyGrid from '../assets/ui/lobby-grid.svg';
import lobbyOrbit1 from '../assets/ui/lobby-orbit-1.svg';
import lobbyOrbit2 from '../assets/ui/lobby-orbit-2.svg';

type Box = readonly [x: number, y: number, w: number, h: number];
interface Scene {
  readonly w: number;
  readonly h: number;
  readonly grid: readonly [string, Box];
  readonly orbit1: readonly [string, Box];
  readonly orbit2: readonly [string, Box];
  readonly glow: Box;
  readonly photon: Box;
  readonly hole: Box;
  readonly unstable: Box;
  readonly reticle: Box;
  readonly gradient: string;
}

/** The two small "Event horizon arena" scenes from the waiting-room and action-selection frames (design pixel boxes). */
const SCENES = {
  lobby: {
    w: 416,
    h: 280,
    grid: [lobbyGrid, [0, 126, 416, 154]],
    orbit1: [lobbyOrbit1, [20, 75, 376, 110]],
    orbit2: [lobbyOrbit2, [40, 60, 336, 140]],
    glow: [124, 32, 168, 168],
    photon: [138, 48, 140, 140],
    hole: [143, 53, 130, 130],
    unstable: [132, 42, 152, 152],
    reticle: [198, 108, 20, 20],
    gradient: 'radial-gradient(ellipse 50% 50% at 50% 42%, #16303a 0%, #10222c 30%, #09131d 60%, #060a10 100%)',
  },
  compact: {
    w: 424,
    h: 230,
    grid: [gameGrid, [0, 103.5, 424, 126.5]],
    orbit1: [gameOrbit1, [20, 75, 384, 110]],
    orbit2: [gameOrbit2, [40, 60, 344, 140]],
    glow: [128, 32, 168, 168],
    photon: [142, 48, 140, 140],
    hole: [147, 53, 130, 130],
    unstable: [136, 42, 152, 152],
    reticle: [202, 108, 20, 20],
    gradient: 'radial-gradient(ellipse 50% 50% at 50% 42%, #16303a 0%, #10222c 30%, #09131d 60%, #060a10 100%)',
  },
} as const satisfies Record<string, Scene>;

export type SceneName = keyof typeof SCENES;

const Img = ({ src, className = 'absolute block inset-0 size-full max-w-none' }: { src: string; className?: string }) => <img alt="" src={src} className={className} draggable={false} />;

/** The black-hole decoration used beside the room code and next to the standings; scales with its container. */
export function ArenaScene({ scene }: { scene: SceneName }) {
  const s: Scene = SCENES[scene];
  const at = ([x, y, w, h]: Box) => ({ left: `${(x / s.w) * 100}%`, top: `${(y / s.h) * 100}%`, width: `${(w / s.w) * 100}%`, height: `${(h / s.h) * 100}%` });
  const Layer = ({ box, children }: { box: Box; children: ReactNode }) => (
    <div className="absolute" style={at(box)} aria-hidden="true">
      {children}
    </div>
  );
  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${s.w} / ${s.h}` }} role="img" aria-label="Decorative black hole above a perspective grid" data-testid={`arena-scene-${scene}`}>
      <div className="absolute inset-0" style={{ background: s.gradient }} aria-hidden="true" />
      <Layer box={s.grid[1]}>
        <Img src={s.grid[0]} />
      </Layer>
      <Layer box={s.orbit1[1]}>
        <Img src={s.orbit1[0]} />
      </Layer>
      <Layer box={s.orbit2[1]}>
        <Img src={s.orbit2[0]} />
      </Layer>
      <Layer box={s.glow}>
        <div className="absolute inset-[-16.67%]">
          <Img src={glow} className="block size-full max-w-none" />
        </div>
      </Layer>
      <Layer box={s.photon}>
        <div className="absolute inset-[-11.43%]">
          <Img src={photon} className="block size-full max-w-none" />
        </div>
      </Layer>
      <Layer box={s.hole}>
        <Img src={hole} />
      </Layer>
      <Layer box={s.unstable}>
        <div className="absolute inset-[0_32.9%_70.71%_4.68%]">
          <Img src={unstable} className="block size-full max-w-none" />
        </div>
      </Layer>
      <Layer box={s.reticle}>
        <Img src={targetReticle} />
      </Layer>
      <p className="absolute left-0 top-3 whitespace-nowrap font-plex text-[10px] text-[#50e3ed]">ANOMALY / 001</p>
      <p className="absolute bottom-2 left-0 whitespace-nowrap font-plex text-[10px] text-[#91a5b6]">— TRUST NO ONE. DEFY GRAVITY.</p>
    </div>
  );
}

/** The shared footer strip of the lobby / match screens. */
export function SystemFooter({ detail }: { detail: string }) {
  return (
    <footer className="border-t border-[#243747]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-8 lg:px-14">
        <p className="flex items-center gap-[10px] font-plex text-[10px] text-[#91a5b6]">
          <img src={connectionIndicator} alt="" aria-hidden="true" className="size-[6px]" />
          ALL SYSTEMS OPERATIONAL
          <span className="text-[#546b7d]">/ {detail}</span>
        </p>
        <p className="font-plex text-[10px] text-[#546b7d]">A LITTLE STRATEGY. A LOT OF CHAOS.</p>
      </div>
    </footer>
  );
}
