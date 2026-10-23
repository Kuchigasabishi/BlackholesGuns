import circleHelp from '../assets/landing/circle-help.svg';
import emblem from '../assets/landing/emblem.svg';
import keyboardIcon from '../assets/landing/keyboard.svg';
import onlineIndicator from '../assets/landing/online-indicator.svg';
import orbitIcon from '../assets/landing/orbit.svg';
import switchOff from '../assets/landing/switch-off.svg';
import { useGameState, useSettings } from '../hooks';

/** A pill toggle from the design: icon, label, OFF/ON state and a switch. A real `role="switch"` button bound to our settings. */
function PreferenceToggle({ icon, label, checked, onChange, hint, testId }: { icon: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-[10px] rounded-[4px] border border-[#243747] bg-[#0c1420] px-[13px] py-[10px] font-plex hover:border-[#50e3ed]/60"
    >
      <img src={icon} alt="" aria-hidden="true" className="size-[15px] shrink-0" />
      <span className="whitespace-nowrap text-[11px] text-[#91a5b6]">{label}</span>
      <span className={`text-[10px] ${checked ? 'font-bold text-[#50e3ed]' : 'text-[#eef6fa]'}`}>{checked ? 'ON' : 'OFF'}</span>
      {checked ? (
        // The design only ships the OFF switch; the ON state is the same 25x14 track with the thumb moved over and lit.
        <span aria-hidden="true" className="relative h-[14px] w-[25px] shrink-0 rounded-full border border-[#50e3ed] bg-[#132e37]">
          <span className="absolute right-[3px] top-[2px] size-[8px] rounded-full bg-[#50e3ed]" />
        </span>
      ) : (
        <img src={switchOff} alt="" aria-hidden="true" className="h-[14px] w-[25px] shrink-0" />
      )}
    </button>
  );
}

/**
 * The console toolbar from the landing prototype: game identity + live server status on the left, the accessibility
 * toggles (Reduced motion, Keyboard shortcuts) and "Show keyboard help" on the right. Shown on every screen.
 */
export function SiteToolbar({ help, onToggleHelp }: { help: boolean; onToggleHelp: () => void }) {
  const { connection } = useGameState();
  const { reducedMotion, setReducedMotion, keyboardMode, setKeyboardMode } = useSettings();
  const online = connection === 'connected';
  return (
    <div className="border-b border-[#243747]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-8 lg:px-14 lg:py-[29px]">
        <div className="flex items-center gap-4">
          <img src={emblem} alt="" aria-hidden="true" className="size-10 shrink-0" />
          <div className="flex flex-col gap-[5px]">
            <p className="font-grotesk text-[18px] font-bold leading-none text-[#eef6fa]">BH / G</p>
            <p className="flex items-center gap-[6px] font-plex text-[10px] leading-none" data-testid="connection" role="status">
              {online ? (
                <img src={onlineIndicator} alt="" aria-hidden="true" className="size-[5px]" />
              ) : (
                <span aria-hidden="true" className={`size-[5px] rounded-full ${connection === 'connecting' ? 'bg-[#ffd54d]' : 'bg-[#ff7b7b]'}`} />
              )}
              <span className={online ? 'text-[#8ce5b4]' : connection === 'connecting' ? 'text-[#ffd54d]' : 'text-[#ff7b7b]'}>
                {online ? 'SERVER ONLINE' : connection === 'connecting' ? 'CONNECTING…' : 'OFFLINE — RECONNECTING'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Accessibility settings">
          <PreferenceToggle testId="toggle-reduced-motion" icon={orbitIcon} label="Reduced motion" checked={reducedMotion} onChange={setReducedMotion} />
          <PreferenceToggle testId="toggle-keyboard" icon={keyboardIcon} label="Keyboard shortcuts" checked={keyboardMode} onChange={setKeyboardMode} hint="Enable single-key shortcuts (C, 1-7, L)" />
          <button
            type="button"
            aria-expanded={help}
            onClick={onToggleHelp}
            className="flex items-center gap-2 px-[14px] py-[10px] font-plex text-[11px] text-[#91a5b6] hover:text-[#eef6fa]"
          >
            <img src={circleHelp} alt="" aria-hidden="true" className="size-4" />
            {help ? 'Hide' : 'Show'} keyboard help
          </button>
        </div>
      </div>
    </div>
  );
}
