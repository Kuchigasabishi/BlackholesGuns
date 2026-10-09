import { useState, type FormEvent } from 'react';
import { HowToPlay } from '../components/HowToPlay';
import { useGameState, useStore } from '../hooks';

/** Pulls a room code out of the current URL when someone opens an invite link (/join/CODE). */
export const codeFromLocation = (pathname: string): string => /^\/join\/([A-Za-z0-9]+)\/?$/.exec(pathname)?.[1]?.toUpperCase() ?? '';

export function HomeScreen({ initialCode = '' }: { initialCode?: string }) {
  const store = useStore();
  const { error, notice, connection } = useGameState();
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const online = connection === 'connected';

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    void run(() => store.createRoom(name));
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    void run(() => store.joinRoom(code, name));
  };

  return (
    <main id="main" className="mx-auto flex min-h-[80vh] max-w-3xl flex-col justify-center gap-8 px-4 py-10">
      <header className="text-center">
        <h1 className="font-display text-4xl font-black tracking-wide text-neon sm:text-5xl">
          BLACKHOLES <span className="text-neon-pink">&amp;</span> GUNS
        </h1>
        <p className="mt-3 text-ink-dim">Secretly pick. Reveal together. Last one standing wins. First to 10 match wins takes the series.</p>
        <div className="mt-5 flex justify-center">
          <HowToPlay />
        </div>
      </header>

      {notice && (
        <p role="status" className="neon-box rounded-lg px-4 py-3 text-gold">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger bg-danger/10 px-4 py-3 text-danger">
          <span className="bracket font-bold">[ERROR]</span> {error}
        </p>
      )}
      {!online && (
        <p role="status" className="text-center text-ink-dim">
          Connecting to the server…
        </p>
      )}

      <section className="neon-box rounded-2xl p-6" aria-labelledby="who">
        <h2 id="who" className="font-display text-lg text-neon">
          Your name
        </h2>
        <label htmlFor="display-name" className="sr-only">
          Display name
        </label>
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoComplete="nickname"
          placeholder="e.g. NoobSlayer"
          className="mt-3 w-full rounded-lg border border-edge bg-void px-4 py-3 text-lg text-ink placeholder:text-ink-dim/60"
        />
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <form onSubmit={onCreate} className="neon-box rounded-2xl p-6">
          <h2 className="font-display text-lg text-neon">Host a game</h2>
          <p className="mt-2 text-sm text-ink-dim">Create a private room and share the code or link. 2–8 players.</p>
          <button
            type="submit"
            disabled={!online || busy}
            className="mt-5 w-full rounded-lg bg-neon px-4 py-3 font-bold text-void hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create room
          </button>
        </form>

        <form onSubmit={onJoin} className="neon-box rounded-2xl p-6">
          <h2 className="font-display text-lg text-neon-pink">Join a game</h2>
          <label htmlFor="room-code" className="mt-2 block text-sm text-ink-dim">
            Room code or invite link
          </label>
          <input
            id="room-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="K7M2QP"
            className="bracket mt-2 w-full rounded-lg border border-edge bg-void px-4 py-3 text-lg uppercase text-ink placeholder:text-ink-dim/60"
          />
          <button
            type="submit"
            disabled={!online || busy || code.trim().length === 0}
            className="mt-4 w-full rounded-lg bg-neon-pink px-4 py-3 font-bold text-void hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Join room
          </button>
        </form>
      </div>
    </main>
  );
}
