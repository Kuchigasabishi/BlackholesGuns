/** Network-related settings read from the environment (kept separate from main.ts so they can be tested). */
export interface NetworkEnv {
  readonly port: number;
  /** Undefined = listen on every interface (IPv4 + IPv6). Set HOST=0.0.0.0 to force IPv4-only, or 127.0.0.1 for local-only. */
  readonly host: string | undefined;
  /** Tunnel mode (ngrok etc.): relaxed CORS and invite links built from the forwarded host. */
  readonly tunnel: boolean;
  /** CORS_ORIGIN: '*' or a comma-separated allow-list. Defaults to '*' in tunnel mode, otherwise unset (server default). */
  readonly corsOrigin: string | readonly string[] | undefined;
  /** Derive invite links from the request's forwarded host (tunnel mode, unless PUBLIC_BASE_URL pins one). */
  readonly inferBaseUrl: boolean;
}

export function readNetworkEnv(env: Record<string, string | undefined>): NetworkEnv {
  const tunnel = env.TUNNEL === '1';
  const raw = env.CORS_ORIGIN?.trim();
  const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const corsOrigin = list.length === 0 ? (tunnel ? '*' : undefined) : list.includes('*') ? '*' : list;
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST?.trim() || undefined,
    tunnel,
    corsOrigin,
    inferBaseUrl: tunnel && !env.PUBLIC_BASE_URL,
  };
}
