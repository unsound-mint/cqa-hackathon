import { semanticAnswers } from './helpers/semantic.js';
import { describe, expect, it } from 'vitest';
import type { Conversation, Criterion } from '@cqa/contracts';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';
import { evaluateConversation } from '../src/services/evaluation/evaluator.js';
import { SYSTEM_PROMPT, systemPromptFor } from '../src/services/evaluation/prompts.js';
import { buildOutputSchema } from '../src/services/evaluation/output-schema.js';
import { originalCriterion } from '../src/services/evaluation/rubric.js';
import { DETECTORS } from '../src/services/evaluation/detectors/index.js';
import { deriveFacts } from '../src/services/evaluation/facts.js';

const criterion=(id:string)=>ORIGINAL_CHECKLIST.criteria.find(c=>c.id===id)!;
const conversation:Conversation={id:'fictional-calibration',datasetGroupId:'fictional',language:'EN',channel:'agent chat',audioUrl:null,transcript:[
 {index:0,timestamp:'00:00',speaker:'client',text:'Where is my receipt?'},
 {index:1,timestamp:'00:01',speaker:'system',text:'Chat transferred to an agent.'},
 {index:2,timestamp:'04:01',speaker:'operator',text:'The receipt is under Documents.'},
]};

it('matches original semantics across id/title/weight changes but excludes edited instructions',()=>{
 const renamed={...criterion('06'),id:'communication',weight:2,title:'Communication'};
 expect(originalCriterion(renamed)?.id).toBe('06');
 expect(systemPromptFor([renamed])).toContain('The FIRST-response three-minute SLA');
 const changed={...renamed,instructions:'Grade the first response within 180 seconds.'};
 expect(originalCriterion(changed)).toBeUndefined();
 expect(systemPromptFor([changed])).toBe(SYSTEM_PROMPT);
});

it('does not let other original examples override a replaced criterion',()=>{
 const changed={...criterion('06'),instructions:'Grade the first response within 180 seconds.'};
 const prompt=systemPromptFor([changed,criterion('04')]);
 expect(prompt).toContain('CONSULTATION QUALITY');
 expect(prompt).not.toContain('The FIRST-response three-minute SLA');
});

it('scopes reviewed confidentiality and closing policy to their original semantics',()=>{
 expect(systemPromptFor([criterion('08')])).toContain('Verification is No and confidential-disclosure flag is Yes');
 expect(systemPromptFor([criterion('07')])).toContain('"Happy to help. Goodbye!" is also Yes');
 expect(systemPromptFor([{...criterion('07'),instructions:'Only an explicit future-help question counts.'}])).toBe(SYSTEM_PROMPT);
});

it('leaves social closing phrases to contextual evaluation',()=>{
 const c={...conversation,transcript:[{index:0,timestamp:'00:00',speaker:'operator' as const,text:'Happy to help. Goodbye!'}]};
 expect(DETECTORS.closing!.run({conversation:c,facts:deriveFacts(c),criterion:criterion('07')})).toBeNull();
});

it('requests the validated explanation language in the schema',()=>{
 expect(buildOutputSchema([criterion('04')],[],'KZ').properties.results.items.properties.explanation.description).toContain('KZ');
});

it('excludes first-response facts only for original semantics while preserving timestamps and custom timing support',async()=>{
 async function capture(c:Criterion){
  let sent:any;
  await evaluateConversation({name:'fake',model:'fake',async complete(req){sent={...req,user:JSON.parse(req.user)};return {output:{results:sent.user.checklist.criteria.length?[{criterionId:c.id,value:c.kind==='discrete-scale'?10:true,isNA:false,explanation:'e',evidence:[{messageIndex:2,quote:'receipt'}]}]:[],assisted:semanticAnswers(req)}};}},conversation,{...ORIGINAL_CHECKLIST,criteria:[c]});
  return sent;
 }
 const original=await capture(criterion('06'));
 expect(original.user.conversation.transcript).toEqual(conversation.transcript);
 expect(original.user.responseLanguage).toBe('EN');
 expect(original.user.derivedFacts).not.toHaveProperty('secondsFromOperatorJoinToFirstOperatorMessage');
 expect(original.user.derivedFacts.largestGapsBetweenMessages).toEqual([]);
 const custom=await capture({...criterion('06'),kind:'boolean',allowedValues:[true,false],instructions:'First response within 180 seconds.'});
 expect(custom.user.derivedFacts.secondsFromOperatorJoinToFirstOperatorMessage).toBe(240);
 expect(custom.user.derivedFacts.largestGapsBetweenMessages).toContainEqual({fromIndex:1,toIndex:2,seconds:240});
 expect(custom.system).not.toContain('The FIRST-response three-minute SLA');
});
