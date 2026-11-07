import { DemoBundleSchema } from '@cqa/contracts';
import { expect, it } from 'vitest';
import demo from '../../../fixtures/demo.json';
import { evaluationCsv } from '../src/lib/export';

const b = DemoBundleSchema.parse(demo);
const conversation = b.conversations[0]!;
const checklist = b.checklists[0]!;

it('exports one row per criterion plus a total, with the AI answer next to the final one and evidence quotes', () => {
  const csv = evaluationCsv(conversation, b.evaluations[0]!, checklist);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  expect(lines[0]).toMatch(/^Диалог;Критерий;Название;Вес;Ответ ИИ;Итоговый ответ;Баллы/);
  expect(lines).toHaveLength(1 + 8 + 1);
  expect(csv.startsWith('﻿')).toBe(true);
  const r03 = lines.find((l) => l.includes(';03;'))!;
  expect(r03).toContain('#6 «Личность клиента подтверждена»; #8 «Вижу заказ 48213»');
  expect(lines.at(-1)).toContain('94.12');
});

it('quotes separators, doubles quotes, and keeps spreadsheet formulas as text', () => {
  const ev = structuredClone(b.evaluations[0]!);
  ev.finalResults[0]!.explanation = '=HYPERLINK("http://x";"y"), второй; пункт\nстрока';
  ev.finalResults[1]!.explanation = '+7 700 000';
  const csv = evaluationCsv(conversation, ev, checklist);
  expect(csv).toContain(`"'=HYPERLINK(""http://x"";""y""), второй; пункт\nстрока"`);
  expect(csv).toContain(";'+7 700 000;");
});

it('shows the reviewer change: original answer and final answer differ', () => {
  const ev = structuredClone(b.evaluations[0]!);
  ev.finalResults.find((r) => r.criterionId === '04')!.value = 20;
  const row = evaluationCsv(conversation, ev, checklist).split('\r\n').find((l) => l.includes(';04;'))!.split(';');
  expect(row[4]).toBe('15 из 20');
  expect(row[5]).toBe('20 из 20');
});
