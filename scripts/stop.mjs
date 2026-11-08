// Stops whatever is listening on the app's port (PORT, default 8787): the server started by `pnpm start` or `pnpm dev:api`.
//   pnpm stop
// Only the listener on that port is signalled, and its command line is printed first. Works on Linux, macOS and Windows.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env')); } catch { /* optional */ }
const port = Number(process.env.PORT ?? 8787);
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

function listeners() {
  if (process.platform === 'win32') {
    const rows = run('netstat', ['-ano', '-p', 'TCP']).split('\n').filter((l) => /LISTENING/.test(l) && new RegExp(`[:.]${port}\\s`).test(l));
    return [...new Set(rows.map((l) => Number(l.trim().split(/\s+/).pop())))].filter(Boolean);
  }
  const lsof = run('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (lsof) return [...new Set(lsof.split('\n').filter(Boolean).map(Number))];
  // lsof is not installed everywhere; ss prints users:(("name",pid=123,fd=4))
  return [...new Set([...run('ss', ['-ltnpH', `sport = :${port}`]).matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
}

const pids = listeners().filter((p) => p !== process.pid);
if (!pids.length) { console.log(`nothing is listening on port ${port}`); process.exit(0); }
for (const pid of pids) {
  const what = process.platform === 'win32' ? '' : run('ps', ['-o', 'args=', '-p', String(pid)]).trim();
  try { process.kill(pid); console.log(`stopped pid ${pid}${what ? `: ${what}` : ''}`); }
  catch (e) { console.error(`could not stop pid ${pid}: ${e.message}`); process.exitCode = 1; }
}
