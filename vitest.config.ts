import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts', 'web/tests/**/*.test.{ts,tsx}'],
    environment: 'node', // component tests opt in with `// @vitest-environment jsdom`
  },
});
