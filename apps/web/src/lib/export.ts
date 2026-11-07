import type { ChecklistVersion, Conversation, CriterionResult, Evaluation } from '@cqa/contracts';
import { earnedPoints, outcome } from './present';

/** Spreadsheet formulas in exported text (a customer quote starting with "=") must stay text. */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const cell = (v: string | number | null | undefined) => {
  const s = safe(String(v ?? ''));
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const evidenceText = (r: CriterionResult) => r.evidence.map((e) => `#${e.messageIndex}${e.quote ? ` «${e.quote}»` : ''}`).join('; ');

/** One row per criterion of the final result, with the original AI answer next to it. `;` separators and a BOM open correctly in Excel. */
export function evaluationCsv(conversation: Conversation, evaluation: Evaluation, checklist: ChecklistVersion | undefined): string {
  const head = ['Диалог', 'Критерий', 'Название', 'Вес', 'Ответ ИИ', 'Итоговый ответ', 'Баллы', 'Причина N/A', 'Объяснение', 'Основания', 'Решение', 'Уверенность'];
  const originals = new Map(evaluation.originalResults.map((r) => [r.criterionId, r]));
  const rows = evaluation.finalResults.map((r) => {
    const c = checklist?.criteria.find((x) => x.id === r.criterionId);
    const o = originals.get(r.criterionId);
    return [conversation.id, r.criterionId, c?.title ?? '', c?.weight ?? '', o ? outcome(c, o).label : '', outcome(c, r).label, earnedPoints(c, r) ?? '', r.naReason ?? '', r.explanation, evidenceText(r), r.source ?? '', r.confidence ?? ''];
  });
  rows.push([conversation.id, '', 'Итоговый балл', '', evaluation.originalTotal ?? '', evaluation.finalTotal ?? '', '', '', evaluation.seriousViolation ? 'Грубое нарушение' : 'Грубых нарушений нет', '', '', '']);
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

export function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
