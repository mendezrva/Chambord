/**
 * Starts the Glockenfels server.
 *   PORT       port to listen on (default 8787)
 *   DATA_DIR   folder for the SQLite file (default ./data)
 *   CLIENT_DIR built client to serve (default ../client/dist)
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { GameServer } from './server';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const dataDir = resolve(process.env.DATA_DIR ?? join(here, '..', 'data'));
const clientDir = resolve(process.env.CLIENT_DIR ?? join(here, '..', '..', 'client', 'dist'));

const server = new GameServer({
  port,
  dbFile: join(dataDir, 'glockenfels.db'),
  staticDir: existsSync(clientDir) ? clientDir : undefined,
});
const p = await server.listen();
console.log(`Glockenfels server on http://localhost:${p}${existsSync(clientDir) ? '' : ' (no client build found; run npm run build)'}`);
console.log(`Data in ${dataDir}`);

// One bad message must never take everyone's game down with it.
process.on('uncaughtException', (e) => console.error('Uncaught:', e));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

const stop = () => { server.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
