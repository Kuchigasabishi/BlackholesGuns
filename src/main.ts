import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readNetworkEnv } from './env';
import { createFileReplayStore, createGameServer, createStdoutTelemetry } from './server';

const env = process.env;
const net = readNetworkEnv(env);
const port = net.port;
// Railway exposes the service's public hostname as RAILWAY_PUBLIC_DOMAIN; PUBLIC_BASE_URL overrides it.
const baseUrl = env.PUBLIC_BASE_URL ?? (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined);

// Test hooks rewrite game state. They are opt-in and refused outright in production.
const devMode = env.DEV_HOOKS === '1';
if (devMode && env.NODE_ENV === 'production') {
  console.error('Refusing to start: DEV_HOOKS=1 is not allowed when NODE_ENV=production');
  process.exit(1);
}

if (net.tunnel && env.NODE_ENV === 'production') {
  console.error('Refusing to start: tunnel mode (open CORS) is not allowed when NODE_ENV=production');
  process.exit(1);
}

const builtClient = resolve('web/dist');
const staticDir = env.STATIC_DIR ?? (existsSync(builtClient) ? builtClient : undefined);

const server = createGameServer({
  config: {
    ...(baseUrl ? { baseUrl, corsOrigin: baseUrl } : {}),
    ...(env.COMMIT_WINDOW_MS ? { commitWindowMs: Number(env.COMMIT_WINDOW_MS) } : {}),
    ...(env.RECONNECT_GRACE_MS ? { reconnectGraceMs: Number(env.RECONNECT_GRACE_MS) } : {}),
    ...(env.INTER_TURN_DELAY_MS ? { interTurnDelayMs: Number(env.INTER_TURN_DELAY_MS) } : {}),
    ...(env.SERVER_SEED ? { seed: env.SERVER_SEED } : {}),
    // In dev the Vite dev server (another origin) talks to this one.
    ...(devMode ? { corsOrigin: '*' } : {}),
    // CORS_ORIGIN, or '*' in tunnel mode; invite links follow the tunnel's forwarded host.
    ...(net.corsOrigin ? { corsOrigin: net.corsOrigin } : {}),
    ...(net.inferBaseUrl ? { inferBaseUrl: true } : {}),
  },
  telemetry: createStdoutTelemetry(),
  devMode,
  ...(env.DEV_TOKEN ? { devToken: env.DEV_TOKEN } : {}),
  ...(env.REPLAY_DIR ? { replayStore: createFileReplayStore(env.REPLAY_DIR) } : {}),
  ...(staticDir ? { staticDir } : {}),
});

server.listen(port, net.host).then((p) => {
  console.info(`Blackholes & Guns server listening on ${net.host ?? 'all interfaces'}:${p}${devMode ? ' (DEV HOOKS ENABLED)' : ''}${staticDir ? ` serving ${staticDir}` : ''}`);
  if (net.tunnel) {
    console.info(`TUNNEL MODE: open CORS, invite links follow the forwarded host. Run:  ngrok http ${p}`);
    if (!staticDir) console.warn('No built client found: run `npm run build:web` first so the tunnel serves the game UI.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}
