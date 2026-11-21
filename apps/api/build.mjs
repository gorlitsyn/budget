// Сборка api в один файл для образа. better-sqlite3 — нативный модуль, остаётся в node_modules.
import fs from 'node:fs';
import { build } from 'esbuild';

// Ревизию пишет scripts/remote-deploy.sh в корень копии репо на сервере.
let revision = 'dev';
try {
  revision = fs.readFileSync(new URL('../../REVISION', import.meta.url), 'utf8').trim();
} catch {}

await build({
  entryPoints: ['src/index.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['better-sqlite3'],
  sourcemap: true,
  define: { __REVISION__: JSON.stringify(revision) },
  // Часть зависимостей Fastify — CommonJS и зовёт require(); в ESM-бандле его нужно создать.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
