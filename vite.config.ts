import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  // tools/ holds the slow AI-vs-AI balance batch: run it with `npm run balance`
  test: { include: process.env.GD_BALANCE ? ['tools/balance.test.ts'] : ['tests/**/*.test.ts'] },
});
