// `npm run start:tunnel`: the normal server with tunnel mode switched on (works the same on Windows, macOS and Linux).
process.env.TUNNEL = '1';
await import('./main');
export {};
