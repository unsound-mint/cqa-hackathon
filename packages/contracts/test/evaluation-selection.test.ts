import { expect, it } from 'vitest';
import { evaluationMaps, type Evaluation } from '../src/index.js';
const original: Evaluation = { id: 'good', conversationId: 'a', checklistVersionId: 'v1', status: 'completed', originalResults: [], finalResults: [], originalTotal: 50, finalTotal: 60, seriousViolation: false };
it('keeps successful scores, human changes and originals visible after a failed rerun or changed checklist', () => {
  const failure: Evaluation = { ...original, id: 'failed', checklistVersionId: 'v2', status: 'failed', originalResults: [], finalResults: [], originalTotal: null, finalTotal: null };
  const maps = evaluationMaps([original, failure]);
  expect(maps.attempts.get('a')).toBe(failure);
  expect(maps.preferred.get('a')).toBe(original);
  expect(maps.preferred.get('a')).toMatchObject({ originalTotal: 50, finalTotal: 60, checklistVersionId: 'v1' });
  const recovered = { ...original, id: 'recovered', checklistVersionId: 'v2' };
  expect(evaluationMaps([original, failure, recovered]).preferred.get('a')).toBe(recovered);
  expect(evaluationMaps([failure]).preferred.get('a')).toBe(failure);
});
