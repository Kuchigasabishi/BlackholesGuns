import type { IncomingHttpHeaders } from 'node:http';

const HOST = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/i;
const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();

/**
 * The public origin a request was addressed to, as seen through a tunnel/proxy
 * (`X-Forwarded-Proto` / `X-Forwarded-Host`, falling back to `Host`). Returns
 * undefined for anything that is not a plain host[:port], so a crafted header
 * can never inject markup or a path into an invite link.
 */
export function publicBaseFromHeaders(headers: IncomingHttpHeaders): string | undefined {
  const host = first(headers['x-forwarded-host']) ?? first(headers.host);
  const proto = (first(headers['x-forwarded-proto']) ?? 'http').toLowerCase();
  if (!host || !HOST.test(host) || (proto !== 'http' && proto !== 'https')) return undefined;
  return `${proto}://${host}`;
}
