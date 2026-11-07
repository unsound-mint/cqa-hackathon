import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * Design rule (docs/DESIGN.md): spacing and sizes sit on a 4px grid (layout in multiples of 8), type uses the
 * fixed scale. Tailwind's half steps (0.5 = 2px, 1.5 = 6px, 2.5 = 10px, 3.5 = 14px) and arbitrary pixel values
 * that are not multiples of 4 break the rhythm, so they fail here instead of in review.
 */
const SPACING = /(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|size|w|h|min-w|min-h|max-w|max-h|top|left|right|bottom|inset|translate-x|translate-y)-(\d+\.5)(?![\w.])/g;
const ARBITRARY = /(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|size|w|h|min-w|min-h|max-w|max-h|top|left|right|bottom|text)-\[(\d+(?:\.\d+)?)(px|rem)\]/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

it('uses no half-step spacing and no off-grid arbitrary sizes', () => {
  const bad: string[] = [];
  for (const f of files(join(__dirname, '../src'))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(SPACING)) bad.push(`${f.split('/src/')[1]}: ${m[0]} (half step)`);
    for (const m of text.matchAll(ARBITRARY)) {
      const px = m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
      if (px % 4 !== 0) bad.push(`${f.split('/src/')[1]}: ${m[0]} (${px}px is not a multiple of 4)`);
    }
  }
  expect(bad).toEqual([]);
});
