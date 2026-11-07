// Installs the committed DEV snapshot (data/seed) so the app starts with conversations, evaluations and recordings.
// Never overwrites: an existing database or recording is left alone. Usage: pnpm seed
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = join(root, 'data', 'seed');
const dbTarget = join(root, 'data', 'cqa.sqlite');
const audioTarget = join(root, 'data', 'private', 'audio');

mkdirSync(dirname(dbTarget), { recursive: true });
if (existsSync(dbTarget)) console.log('data/cqa.sqlite exists: kept as is (delete it to reseed)');
else {
  copyFileSync(join(seed, 'cqa-dev.db'), dbTarget);
  console.log('installed data/cqa.sqlite');
}
mkdirSync(audioTarget, { recursive: true });
let n = 0;
for (const f of readdirSync(join(seed, 'audio'))) {
  if (existsSync(join(audioTarget, f))) continue;
  copyFileSync(join(seed, 'audio', f), join(audioTarget, f));
  n++;
}
console.log(`copied ${n} recording file(s) to data/private/audio`);
