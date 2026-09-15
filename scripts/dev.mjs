// dev-обёртка для `npm start`. Запускается через
// `node --env-file-if-exists=.env scripts/dev.mjs`, поэтому переменные из .env
// уже в process.env.
//
// Последовательно:
//   1. brand-sync (создаёт public/assets/{brand.json,logo.*,runtime-config.js}).
//   2. ng serve --port $PORT — Angular dev-сервер на порту из .env (default 4200).

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || '4200';
// HOST=0.0.0.0 — слушаем все интерфейсы (нужно для доступа по LAN-IP,
// телефона в той же сети, ngrok-туннелю и т.п.). --allowed-hosts all
// отключает host-check Vite-based dev-сервера Angular, иначе он отвергает
// запросы с Host != localhost.
const host = process.env.HOST || '0.0.0.0';

const sync = spawnSync(process.execPath, [resolve(__dirname, 'sync-brand-config.mjs')], {
  stdio: 'inherit',
});
if (sync.status !== 0) process.exit(sync.status ?? 1);

const ng = spawn(
  'npx',
  ['ng', 'serve', '--host', host, '--port', port, '--allowed-hosts=true'],
  { stdio: 'inherit' },
);
ng.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => ng.kill('SIGINT'));
process.on('SIGTERM', () => ng.kill('SIGTERM'));
