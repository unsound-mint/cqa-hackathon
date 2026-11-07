import { describe, expect, it } from 'vitest';
import type { Conversation, Criterion } from '@cqa/contracts';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';
import { deriveFacts } from '../src/services/evaluation/facts.js';
import { planCriteria, evaluateConversation } from '../src/services/evaluation/evaluator.js';
import { needsDetector } from '../src/services/evaluation/semantic/needs.js';
import { consultationDetector } from '../src/services/evaluation/semantic/consultation.js';
import { dialogueDetector } from '../src/services/evaluation/semantic/dialogue.js';
import type { AssistedDetector } from '../src/services/evaluation/detectors/types.js';

const conversation: Conversation = {
  id: 'fictional-facts', datasetGroupId: 'safe', language: 'EN', channel: 'agent chat', audioUrl: null,
  transcript: [
    { index: 0, timestamp: '00:00', speaker: 'client', text: 'Where is the login? What fee applies? Please also name the icon color.' },
    { index: 1, timestamp: '00:10', speaker: 'operator', text: 'Hello, I am Alex. Are you using the app or website? Open the app menu.' },
    { index: 2, timestamp: '00:20', speaker: 'client', text: 'I use the website. What app menu? I cannot follow that instruction.' },
    { index: 3, timestamp: '00:30', speaker: 'operator', text: 'Sorry, open the website login. The fee is zero. The icon is blue. I will check the route.' },
    { index: 4, timestamp: '00:40', speaker: 'client', text: 'That works, thanks.' },
    { index: 5, timestamp: '00:50', speaker: 'operator', text: 'Glad you got in. Goodbye!' },
  ],
};
const ref = (messageIndex: number, quote = conversation.transcript[messageIndex]!.text) => ({ messageIndex, quote });
const common = () => ({ reason: 'Observed exchange.', confidence: 'high' as const });
const input = (id: string, c = conversation) => ({ conversation: c, facts: deriveFacts(c), criterion: ORIGINAL_CHECKLIST.criteria.find(cr => cr.id === id)! });
function decide<A>(helper: AssistedDetector<A>, id: string, raw: unknown, c = conversation) {
  const i = input(id, c); const checked = helper.validate(i, raw);
  expect(checked.problems).toEqual([]);
  expect(checked.answers).toBeDefined();
  return helper.decide(i, checked.answers!);
}
const needs = () => ({ ...common(), usedKnownContext: true, missingDetails: [{ detail: 'Platform', clientRequest: ref(0), operatorQuestion: [ref(1, 'Are you using the app or website?')], firstRelevantAnswer: [ref(1, 'Open the app menu.')] }] });
const request = (materiality: 'main' | 'material' | 'minor', handling: 'answered' | 'concrete_next_step' | 'generic_hint' | 'unanswered', quote: string) => ({ description: quote, clientRequest: ref(0, quote), materiality, handling, operatorEvidence: handling === 'unanswered' ? [] : [ref(3)] });
const consultation = () => ({ ...common(), requests: [request('main', 'answered', 'Where is the login?')], incorrectKeyRecommendation: [] });
const dialogue = () => ({ ...common(), operatorEvidence: [ref(3)], incoherencePreventingUnderstanding: [], forcedClarifications: [], otherCommunicationFlaws: [], waits: [] });

describe('semantic rubric decisions', () => {
  it('02 gives N/A precedence over using known context', () => {
    for (const usedKnownContext of [true, false]) expect(decide(needsDetector, '02', { ...needs(), missingDetails: [], usedKnownContext })).toMatchObject({ value: null, isNA: true });
  });
  it('02 uses question-before-answer ordering, including within one message', () => {
    expect(decide(needsDetector, '02', needs()).value).toBe(true);
    const n = needs(); n.missingDetails[0]!.operatorQuestion = [ref(3)];
    expect(decide(needsDetector, '02', n).value).toBe(false);
    expect(decide(needsDetector, '02', { ...needs(), usedKnownContext: false }).value).toBe(false);
    expect(decide(needsDetector, '02', { ...needs(), missingDetails: [{ ...needs().missingDetails[0], operatorQuestion: [] }] }).value).toBe(false);
  });
  it('04 computes all tiers from actual requested coverage', () => {
    const base = consultation();
    expect(decide(consultationDetector, '04', base).value).toBe(20);
    expect(decide(consultationDetector, '04', { ...base, requests: [request('main', 'concrete_next_step', 'Where is the login?')] }).value).toBe(20);
    expect(decide(consultationDetector, '04', { ...base, requests: [...base.requests, request('minor', 'unanswered', 'Please also name the icon color.')] }).value).toBe(15);
    expect(decide(consultationDetector, '04', { ...base, requests: [...base.requests, request('material', 'unanswered', 'What fee applies?')] }).value).toBe(10);
    expect(decide(consultationDetector, '04', { ...base, requests: [request('main', 'generic_hint', 'Where is the login?')] }).value).toBe(5);
    expect(decide(consultationDetector, '04', { ...base, requests: [request('main', 'unanswered', 'Where is the login?')] }).value).toBe(0);
    expect(decide(consultationDetector, '04', { ...base, incorrectKeyRecommendation: [ref(1)] }).value).toBe(0);
    expect(decide(consultationDetector, '04', { ...base, requests: [] })).toMatchObject({ value: null, isNA: true });
  });
  it('06 keeps the forced re-ask tier after successful correction', () => {
    const d = { ...dialogue(), forcedClarifications: [{ operatorWording: ref(1, 'Open the app menu.'), clientReask: ref(2), reason: 'Wrong navigation forced a re-ask.' }] };
    expect(decide(dialogueDetector, '06', d).value).toBe(4);
    expect(decide(dialogueDetector, '06', { ...d, otherCommunicationFlaws: [{ operatorWording: ref(1), reason: 'Disorder.' }] }).value).toBe(4);
    expect(decide(dialogueDetector, '06', { ...d, incoherencePreventingUnderstanding: [{ operatorEvidence: [ref(1)], clientReaction: [ref(2)], reason: 'Cannot understand.' }] }).value).toBe(0);
    expect(decide(dialogueDetector, '06', dialogue()).value).toBe(10);
    expect(decide(dialogueDetector, '06', { ...dialogue(), otherCommunicationFlaws: [{ operatorWording: ref(1), reason: 'Notable flaw.' }] }).value).toBe(7);
  });
  it('06 an announced check is its own advance warning without an ETA', () => {
    expect(decide(dialogueDetector, '06', { ...dialogue(), waits: [{ kind: 'operator_check_announced', start: ref(3, 'I will check the route.'), advanceWarning: [ref(3, 'I will check the route.')] }] }).value).toBe(10);
    expect(decide(dialogueDetector, '06', { ...dialogue(), waits: [{ kind: 'client_wait_complaint', start: ref(2), advanceWarning: [] }] }).value).toBe(7);
  });
  it('validates exact quotes, roles, ranges, causal order and unknown grade fields', () => {
    const invalid = [
      { ...needs(), missingDetails: [{ ...needs().missingDetails[0], operatorQuestion: [ref(0)] }] },
      { ...needs(), missingDetails: [{ ...needs().missingDetails[0], operatorQuestion: [ref(1, 'fabricated')] }] },
      { ...needs(), checkedRange: { from: 3, to: 99 } },
      { ...needs(), value: true },
    ];
    for (const a of invalid) expect(needsDetector.validate(input('02'), a).problems.length).toBeGreaterThan(0);
    expect(dialogueDetector.validate(input('06'), { ...dialogue(), forcedClarifications: [{ operatorWording: ref(3), clientReask: ref(2), reason: 'Bad order.' }] }).problems.join()).toMatch(/follow/);
    expect(consultationDetector.validate(input('04'), { ...consultation(), requests: [{ ...request('main', 'answered', 'Where is the login?'), operatorEvidence: [] }] }).problems.join()).toMatch(/requires operator/);
  });
  it('requires actual holds and excludes internal operator speech', () => {
    const c: Conversation = { ...conversation, transcript: conversation.transcript.map(m => m.index === 2 ? { ...m, speaker: 'system', text: 'Клиент находится на удержании.' } : m) };
    expect(dialogueDetector.validate(input('06', c), dialogue()).problems.join()).toMatch(/not client-facing/);
    const facts = { ...dialogue(), operatorEvidence: [ref(1)], waits: [{ kind: 'hold_event', start: { messageIndex: 2, quote: c.transcript[2]!.text }, advanceWarning: [] }] };
    expect(decide(dialogueDetector, '06', facts, c).value).toBe(7);
    expect(dialogueDetector.validate(input('06', c), { ...facts, waits: [] }).problems.join()).toMatch(/missing actual hold/);
  });
  it('does not accuse voice operators of incoherence from ASR alone', () => {
    const c: Conversation = { ...conversation, channel: 'voice call' };
    expect(dialogueDetector.validate(input('06', c), { ...dialogue(), incoherencePreventingUnderstanding: [{ operatorEvidence: [ref(1)], clientReaction: [], reason: 'Garbled fragment.' }] }).problems.join()).toMatch(/client reaction/);
  });
  it('selects helpers by canonical signature, not criterion id or weight', () => {
    const canonical = input('04').criterion;
    const renamed: Criterion = { ...canonical, id: 'renamed', weight: 42 };
    expect(planCriteria(conversation, { ...ORIGINAL_CHECKLIST, criteria: [renamed] }).assisted[0]?.detector.name).toBe('consultation-facts');
    const edited = { ...renamed, instructions: 'Only assess whether the fee was mentioned.' };
    expect(planCriteria(conversation, { ...ORIGINAL_CHECKLIST, criteria: [edited] }).undecided).toEqual([edited]);
  });
  it('expands compact index facts to exact source evidence and rejects bad indices/roles', () => {
    const raw = { ...dialogue(), operatorEvidence: [3], waits: [{ kind: 'operator_check_announced', start: 3, advanceWarning: [3] }] };
    const decided = decide(dialogueDetector, '06', raw);
    expect(decided.value).toBe(10);
    expect(decided.evidence).toContainEqual(ref(3));
    expect(dialogueDetector.validate(input('06'), { ...raw, operatorEvidence: [99] }).problems.length).toBeGreaterThan(0);
    expect(dialogueDetector.validate(input('06'), { ...raw, operatorEvidence: [0] }).problems.join()).toMatch(/operator/);
    expect(dialogueDetector.validate(input('06'), { ...raw, waits: [{ ...raw.waits[0], advanceWarning: [1, 3] }] }).problems.length).toBeGreaterThan(0);
  });
  it('repairs invalid facts, returns typed facts for audit and applies code grade', async () => {
    let calls = 0;
    const r = await evaluateConversation({ name: 'fake', model: 'facts', async complete(req) {
      calls++;
      expect(JSON.parse(req.user).checklist.criteria).toEqual([]);
      return { output: { results: [], assisted: { '02': calls === 1 ? { ...needs(), missingDetails: [{ ...needs().missingDetails[0], operatorQuestion: [ref(0)] }] } : needs() } } };
    } }, conversation, { ...ORIGINAL_CHECKLIST, criteria: [input('02').criterion] });
    expect(calls).toBe(2);
    expect(r.results[0]).toMatchObject({ value: true, source: 'hybrid' });
    expect(r.decisionFacts['02']).toEqual({ kind: 'needs-facts', facts: needs() });
  });
});
