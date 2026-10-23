import perspectiveGrid from '../assets/landing/perspective-grid.svg';
import orbitalTrajectory1 from '../assets/landing/orbital-trajectory-1.svg';
import orbitalTrajectory2 from '../assets/landing/orbital-trajectory-2.svg';
import accretionGlow from '../assets/landing/accretion-glow.svg';
import accretionRim from '../assets/landing/accretion-rim.svg';
import photonRing from '../assets/landing/photon-ring.svg';
import blackHole from '../assets/landing/black-hole.svg';
import unstableOrbit from '../assets/landing/unstable-orbit.svg';
import projectile1 from '../assets/landing/projectile-1.svg';
import projectile2 from '../assets/landing/projectile-2.svg';
import targetReticle from '../assets/landing/target-reticle.svg';

const W = 640;
const H = 340;
/** The design's pixel boxes (640 x 340 canvas) as percentages, so the whole scene scales with its container on phones. */
const box = (x: number, y: number, w: number, h: number) => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
  width: `${(w / W) * 100}%`,
  height: `${(h / H) * 100}%`,
});

const Layer = ({ at, name, children }: { at: ReturnType<typeof box>; name: string; children: React.ReactNode }) => (
  <div className="absolute" style={at} data-layer={name} aria-hidden="true">
    {children}
  </div>
);
const Img = ({ src, className = 'absolute block inset-0 size-full max-w-none' }: { src: string; className?: string }) => <img alt="" src={src} className={className} draggable={false} />;

/**
 * The "Event horizon arena" from the Figma landing prototype: a black hole with accretion glow, photon ring,
 * orbital trajectories, orbiting projectiles, a target reticle and a perspective grid. Every shape is the design's
 * own exported SVG, placed at the design's coordinates; the telemetry texts are live (editable) markup.
 */
export function EventHorizonArena() {
  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }} data-testid="event-horizon-arena" role="img" aria-label="Decorative black hole above a perspective grid">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 50% 50% at 50% 42%, #16303a 0%, #10222c 30%, #09131d 60%, #060a10 100%)' }} aria-hidden="true" />
      <Layer at={box(0, 150, 640, 190)} name="Perspective grid">
        <Img src={perspectiveGrid} />
      </Layer>
      <div className="absolute bg-[#50e3ed] opacity-25" style={box(0, 150, 640, 1)} aria-hidden="true" />
      <Layer at={box(98, 65, 444, 184)} name="Orbital trajectory">
        <Img src={orbitalTrajectory1} />
      </Layer>
      <Layer at={box(65, 90, 510, 145)} name="Orbital trajectory">
        <Img src={orbitalTrajectory2} />
      </Layer>
      <Layer at={box(208, 37, 224, 224)} name="Accretion glow">
        <div className="absolute inset-[-15.63%]">
          <Img src={accretionGlow} className="block size-full max-w-none" />
        </div>
      </Layer>
      <Layer at={box(222, 51, 196, 196)} name="Accretion rim">
        <Img src={accretionRim} />
      </Layer>
      <Layer at={box(233, 62, 174, 174)} name="Photon ring">
        <div className="absolute inset-[-10.34%]">
          <Img src={photonRing} className="block size-full max-w-none" />
        </div>
      </Layer>
      <Layer at={box(239, 68, 162, 162)} name="Black hole">
        <Img src={blackHole} />
      </Layer>
      <Layer at={box(228, 57, 184, 184)} name="Unstable orbit">
        <div className="absolute inset-[0_32.9%_70.71%_4.68%]">
          <Img src={unstableOrbit} className="block size-full max-w-none" />
        </div>
      </Layer>
      <Layer at={box(499, 192, 6, 6)} name="Orbiting projectile">
        <div className="absolute inset-[-200%]">
          <Img src={projectile1} className="block size-full max-w-none" />
        </div>
      </Layer>
      <Layer at={box(133, 114, 5, 5)} name="Orbiting projectile">
        <Img src={projectile2} />
      </Layer>
      <Layer at={box(310, 139, 20, 20)} name="Target reticle">
        <Img src={targetReticle} />
      </Layer>

      <div className="absolute left-0 top-[9.4%] flex flex-col gap-[7px] font-plex leading-normal">
        <p className="text-[11px] text-[#50e3ed]">ANOMALY / 001</p>
        <p className="text-[10px] text-[#546b7d]">GRAVITY WELL DETECTED</p>
      </div>
      <p className="absolute left-[66.25%] top-[84.1%] whitespace-nowrap font-plex text-[10px] text-[#546b7d]">X 045.8 / Y 091.2</p>
      <div className="absolute left-0 top-[90.6%] flex items-center gap-2">
        <span className="h-[2px] w-[18px] bg-[#50e3ed]" aria-hidden="true" />
        <p className="whitespace-nowrap font-plex text-[10px] text-[#91a5b6]">TRUST NO ONE. DEFY GRAVITY.</p>
      </div>
    </div>
  );
}
