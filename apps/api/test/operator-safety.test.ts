import { describe, expect, it } from 'vitest';
import type { Conversation, Criterion } from '@cqa/contracts';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';
import { evaluateConversation, planCriteria, validateModelOutput } from '../src/services/evaluation/evaluator.js';
import { deriveFacts } from '../src/services/evaluation/facts.js';
import { DETECTORS } from '../src/services/evaluation/detectors/index.js';

const conversation: Conversation = {
  id: 'fictional-audit', datasetGroupId: 'fictional', language: 'EN', channel: 'agent chat', audioUrl: null,
  transcript: [
    { index: 0, timestamp: '00:00', speaker: 'bot', text: 'Your refund is approved. Goodbye!' },
    { index: 1, timestamp: '00:01', speaker: 'operator', text: 'Hello, my name is Alice. I cannot help.' },
    { index: 2, timestamp: '00:02', speaker: 'client', text: 'I still need help.' },
  ],
};
const criterion = (id: string) => ORIGINAL_CHECKLIST.criteria.find((c) => c.id === id)!;
const validate = (c: Criterion, value: boolean | number, indices: number[], checkedRange?: {from:number;to:number}) =>
  validateModelOutput({ results: [{ criterionId: c.id, value, isNA: false, explanation: 'test', confidence: 'high',
    evidence: indices.map((messageIndex) => ({ messageIndex, quote: conversation.transcript[messageIndex]!.text })), checkedRange,
  }] }, conversation, { criteria: [c] });

describe('operator attribution', () => {
  it('repairs a bot-only model verdict before persisting operator-attributed results', async () => {
    let calls = 0;
    const result = await evaluateConversation({name:'fictional',model:'stub',async complete(req) {
      calls++;
      if (calls === 2) expect(JSON.parse(req.user).previousAnswerProblems.join()).toMatch(/operator/);
      const index = calls === 1 ? 0 : 1;
      return {output:{results:[{criterionId:'04',value:5,isNA:false,explanation:'fictional test',evidence:[{messageIndex:index,quote:conversation.transcript[index]!.text}]}]}};
    }}, conversation, {...ORIGINAL_CHECKLIST,criteria:[criterion('04')]});
    expect(calls).toBe(2);
    expect(result.results[0]!.evidence[0]!.messageIndex).toBe(1);
  });

  it('grounds arbitrary enum action labels while allowing an absence label with an inspected range', () => {
    const c: Criterion = {id:'custom',title:'Greeting',instructions:'Label operator greeting as present or absent',kind:'enum',allowedValues:['present','absent'],weight:0,allowNA:false};
    const check = (value:string, decisionBasis:string, evidence:object[], checkedRange?:object) => validateModelOutput({results:[{criterionId:c.id,value,isNA:false,explanation:'test',decisionBasis,evidence,checkedRange}]},conversation,{criteria:[c]});
    expect(check('present','operator_action',[{messageIndex:0,quote:conversation.transcript[0]!.text}]).problems.join()).toMatch(/operator/);
    expect(check('absent','absence',[],{from:0,to:2}).problems).toEqual([]);
    expect(check('absent','absence',[]).problems.join()).toMatch(/checkedRange/);
  });

  it.each([['04', 20], ['05', true], ['08', true]] as const)('rejects bot-only evidence for %s', (id, value) => {
    expect(validate(criterion(id), value, [0]).problems.join()).toMatch(/operator/i);
  });
  it('does not allow a checked range to replace proof of a positive action', () => {
    expect(validate(criterion('04'), 20, [], {from:0,to:2}).problems.join()).toMatch(/operator/i);
  });
  it('allows context alongside operator evidence and ranges for absent behavior', () => {
    expect(validate(criterion('04'), 20, [0, 1, 2]).problems).toEqual([]);
    expect(validate(criterion('05'), false, [], {from:0,to:2}).problems).toEqual([]);
    expect(validate(criterion('08'), false, [], {from:0,to:2}).problems).toEqual([]);
  });
});

describe('detector semantics', () => {
  it('does not credit an operator speaking privately during an unclosed hold', () => {
    const c: Conversation = {...conversation, transcript:[
      {index:0,timestamp:'00:00',speaker:'system',text:'Клиент находится на удержании.'},
      {index:1,timestamp:'00:01',speaker:'operator',text:'Hello, my name is Alice. Anything else? Goodbye!'},
    ]};
    expect(deriveFacts(c).operatorMessagesDuringHold).toEqual([1]);
    expect(planCriteria(c, {...ORIGINAL_CHECKLIST,criteria:[criterion('01'),criterion('07')]}).decided.size).toBe(0);
    const result = validateModelOutput({results:[{criterionId:'04',value:20,isNA:false,explanation:'test',evidence:[{messageIndex:1,quote:c.transcript[1]!.text}]}]},c,{criteria:[criterion('04')]});
    expect(result.problems.join()).toMatch(/client-facing operator/);
  });

  it('bypasses the closing detector even when its old conditions would prove Yes', () => {
    const c: Conversation = {...conversation, transcript:[{index:0,timestamp:'00:00',speaker:'operator',text:'Anything else I can help with? Goodbye!'}]};
    const changed = {...criterion('07'),instructions:'Yes only if a complaint number was provided.'};
    expect(planCriteria(c,{...ORIGINAL_CHECKLIST,criteria:[changed]}).undecided).toEqual([changed]);
  });
  it.each(['01', '03', '07'])('does not apply a retained detector after changing %s instructions', (id) => {
    const changed = { ...criterion(id), instructions: 'Yes only if a complaint reference number was provided.' };
    const plan = planCriteria(conversation, { ...ORIGINAL_CHECKLIST, criteria: [changed] });
    expect(plan.decided.size).toBe(0);
    expect(plan.assisted).toEqual([]);
    expect(plan.undecided.map(c=>c.id)).toEqual([id]);
  });
});

describe('verification events', () => {
  it.each([
    'Customer identity verified: false', 'Customer identity verified unsuccessfully.',
    'Customer identity not verified.', 'Customer identity verified? Please check.',
    'Личность клиента подтверждена: нет', 'Личность клиента не подтверждена.',
    'Жеке басы расталды: жоқ', 'Жеке басы расталмады.',
  ])('does not prove successful verification: %s', (text) => {
    expect(deriveFacts({ ...conversation, transcript: [{index:0,timestamp:'00:00',speaker:'system',text}] }).identityVerificationEvents).toEqual([]);
  });
  it.each(['Customer identity verified.', 'Личность клиента подтверждена.', 'Клиенттің жеке басы расталды.'])('accepts affirmative event: %s', (text) => {
    expect(deriveFacts({ ...conversation, transcript: [{index:0,timestamp:'00:00',speaker:'system',text}] }).identityVerificationEvents).toEqual([0]);
  });
});

describe('closing applicability', () => {
  it('leaves a client disconnect after an earlier opportunity to the model', () => {
    const c = {...conversation, transcript: [...conversation.transcript,
      {index:3,timestamp:'15:00',speaker:'system' as const,text:'Customer disconnected.'}]};
    expect(DETECTORS.closing!.run({conversation:c,facts:deriveFacts(c),criterion:criterion('07')})).toBeNull();
  });
});
