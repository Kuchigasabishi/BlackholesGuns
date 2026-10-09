/**
 * Drives real browser sessions (Microsoft Edge via playwright-core) against the
 * real server + built client, and saves screenshots. Run: npm run visual-check
 * (build first: npm run build:web). Output: ./.visual/*.png
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { createGameServer } from '../src/server';

const OUT = resolve('.visual');
mkdirSync(OUT, { recursive: true });

const server = createGameServer({
  config: { commitWindowMs: 120_000, interTurnDelayMs: 6_000, reconnectGraceMs: 30_000, seed: 'visual' },
  devMode: true,
  staticDir: resolve('web/dist'),
});
const port = await server.listen(0);
const base = `http://127.0.0.1:${port}`;
const dev = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const problems: string[] = [];
const newPage = async (name: string, width = 1440, height = 960): Promise<Page> => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${name}] console.error: ${m.text()}`);
  });
  return page;
};
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

try {
  const a = await newPage('ada');
  await a.goto(base);
  await a.waitForSelector('text=Create room');
  await shot(a, '01-home');

  await a.fill('#display-name', 'NoobSlayer');
  await a.click('text=Create room');
  await a.waitForSelector('[data-testid="room-code"]');
  const code = (await a.textContent('[data-testid="room-code"]'))!.trim();
  console.log('room code:', code);

  // Invite link: opening /join/CODE must serve the app and prefill the code.
  const b = await newPage('bo');
  await b.goto(`${base}/join/${code}`);
  await b.waitForSelector('#room-code');
  const prefilled = await b.inputValue('#room-code');
  console.log('invite link prefilled code:', prefilled, prefilled === code ? 'OK' : 'MISMATCH');
  await b.fill('#display-name', 'BotAlpha');
  await b.click('text=Join room');
  await b.waitForSelector('[data-testid="room-code"]');

  const c = await newPage('cy');
  await c.goto(`${base}/join/${code}`);
  await c.fill('#display-name', 'Shadow');
  await c.click('text=Join room');
  await c.waitForSelector('[data-testid="room-code"]');
  await a.waitForFunction(() => document.querySelector('[data-testid="player-count"]')?.textContent?.startsWith('3 / 8'));
  await shot(a, '02-lobby-host');
  await shot(b, '03-lobby-guest');

  await a.click('text=Start game');
  await a.waitForSelector('[data-testid="control-panel"]');
  await b.waitForSelector('[data-testid="control-panel"]');
  await c.waitForSelector('[data-testid="control-panel"]');
  await a.waitForTimeout(400);
  await shot(a, '04-game-turn1');

  // Give players some Charge and a streak so the UI has something to show.
  await dev('/dev/charges', { roomCode: code, charges: { p1: 3, p2: 2, p3: 0 } });
  await dev('/dev/streak', { roomCode: code, streak: 3 });
  await a.waitForSelector('[data-testid="streak"]:has-text("STREAK: 3")');
  await a.hover('button[data-action="NUKE"]');
  await shot(a, '05-game-charge3-dimmed-attacks');

  // Ada: Katana at Bo and Shadow. Bo: Dodge. Shadow: Charge. (Shadow gets eliminated.)
  await a.click('button[data-action="KATANA"]');
  await a.click('[data-testid="target-picker"] >> text=BotAlpha');
  await a.click('[data-testid="target-picker"] >> text=Shadow');
  await shot(a, '06-game-target-picker');
  await a.click('[data-testid="lock-in"]');
  await a.waitForSelector('[data-testid="locked-indicator"]');
  await b.click('button[data-action="DODGE"]');
  await b.click('[data-testid="lock-in"]');
  await shot(b, '07-game-guest-before-reveal');
  await c.click('button[data-action="CHARGE"]');
  await c.click('[data-testid="lock-in"]');

  await a.waitForSelector('[data-testid^="reveal-"]');
  await a.waitForTimeout(2600); // let the log play back
  await shot(a, '08-game-reveal-with-eliminated');
  await shot(c, '09-game-eliminated-view');

  // Two players left: force Sudden Death.
  await a.waitForSelector('[data-testid="control-panel"] >> text=LOCK IN', { timeout: 15000 });
  await dev('/dev/streak', { roomCode: code, streak: 10 });
  await a.waitForSelector('[data-testid="phase-notice"]');
  await a.waitForTimeout(1000);
  const sd = await a.evaluate(() =>
    ['DODGE', 'SHIELD', 'REFLECT', 'CHARGE', 'GUN'].map((id) => {
      const el = document.querySelector<HTMLButtonElement>(`button[data-action="${id}"]`)!;
      return `${id}: aria-disabled=${el.getAttribute('aria-disabled')} class=${el.className.includes('opacity-40') ? 'dim' : 'bright'}`;
    }),
  );
  console.log('SD buttons after 1s:', sd.join(' | '));
  await shot(a, '10-sudden-death');

  // Phone width.
  await a.setViewportSize({ width: 390, height: 844 });
  await a.waitForTimeout(300);
  await shot(a, '11-mobile');

  // Series flow is covered by tests; here, a quick accessibility sanity pass on the live DOM.
  const axe = await a.evaluate(() => {
    const issues: string[] = [];
    document.querySelectorAll('button').forEach((el) => {
      const name = (el.textContent ?? '').trim() || el.getAttribute('aria-label');
      if (!name) issues.push('button without accessible name');
    });
    document.querySelectorAll('img').forEach((el) => {
      if (!el.getAttribute('alt')) issues.push('img without alt');
    });
    if (!document.documentElement.lang) issues.push('missing <html lang>');
    if (!document.title) issues.push('missing <title>');
    return issues;
  });
  console.log('basic a11y issues:', axe.length === 0 ? 'none' : axe);
} finally {
  await browser.close();
  await server.close();
}

console.log(problems.length === 0 ? 'browser console: clean (no errors)' : `browser problems:\n${problems.join('\n')}`);
console.log(`screenshots in ${OUT}`);
