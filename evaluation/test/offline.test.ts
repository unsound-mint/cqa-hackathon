import { describe, it, expect } from 'vitest';
import { KitSchema, validateLabel, validateBackup, labelsCsv } from '../src/offline.js';
import { parseLabels } from '../src/labels.js';
import { checklist, conversation } from './fixture.js';
const kit = KitSchema.parse({ id: 'fictional', checklist, conversations: [conversation] });
const label = { conversationId: conversation.id, criterionId: '01', value: true, isNA: false, evidence: [0], inspectedRange: null, rationale: 'Human note, with punctuation', uncertainty: '', reviewer: 'Tester', adjudicated: false };
describe('offline label delivery', () => {
  it('round trips human labels and leaves other criteria blank', () => {
    const r = parseLabels(labelsCsv(kit, [label]), checklist);
    expect(r.problems).toEqual([]);
    expect(r.labels[0]).toMatchObject({ value: true, rationale: label.rationale, evidence: [0] });
    expect(r.blanks).toHaveLength(checklist.criteria.length - 1);
  });
  it('rejects invalid evidence, ranges, answer and N/A', () => {
    for (const patch of [{evidence: [-1]}, {evidence: [conversation.transcript.length]}, {inspectedRange: {from: 2, to: 1}}, {value: 'maybe'}, {value:null, isNA:true}]) expect(() => validateLabel(kit, {...label, ...patch})).toThrow();
  });
  it('checks backup identity, duplicate pairs and historical labels', () => {
    const b = {profile:{id:'person-a',name:'Person A'}, kitId:kit.id, labels:[label], history:[{at:'2026-11-07', conversationId:label.conversationId, criterionId:label.criterionId, label}]};
    expect(validateBackup(kit,b).labels).toHaveLength(1);
    expect(() => validateBackup(kit,{...b, kitId:'other'})).toThrow();
    expect(() => validateBackup(kit,{...b, labels:[label,label]})).toThrow();
    expect(() => validateBackup(kit,{...b, history:[{...b.history[0], label:{...label,evidence:[999]}}]})).toThrow();
  });
});
