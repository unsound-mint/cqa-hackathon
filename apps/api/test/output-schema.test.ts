import { describe, expect, it } from 'vitest';
import type { Criterion } from '@cqa/contracts';
import { buildOutputSchema } from '../src/services/evaluation/output-schema.js';
import { ASSISTED_DETECTORS } from '../src/services/evaluation/detectors/index.js';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';
import { deriveFacts } from '../src/services/evaluation/facts.js';
import { evaluateConversation, validateAssisted } from '../src/services/evaluation/evaluator.js';
import type { Conversation } from '@cqa/contracts';

const verification = ORIGINAL_CHECKLIST.criteria.find(c=>c.id==='03')!;
const assisted = (id:string) => ({criterion:{...verification,id},detector:ASSISTED_DETECTORS.verification!});
const conversation:Conversation = {id:'fiction',datasetGroupId:'fiction',channel:'agent chat',language:'EN',audioUrl:null,transcript:[
  {index:0,timestamp:'00:00',speaker:'client',text:'Where can I find public tariffs?'},
  {index:1,timestamp:'00:01',speaker:'operator',text:'Public tariffs are on our website.'},
]};
const answer = {verificationRequired:false,firstProtectedDisclosure:null,reason:'Public information needs no identity check.',confidence:'high'};
const criterion:Criterion={id:'custom-rule',title:'t',instructions:'Use the operator answer.',kind:'boolean',allowedValues:[true,false],weight:1,allowNA:false};

describe('request-specific tool schema',()=>{
  it('requires every planned assisted key with the full detector answer schema',()=>{
    const schema=buildOutputSchema([criterion],[assisted('verify-a'),assisted('verify-b')]);
    expect(schema.required).toEqual(['results','assisted']);
    expect(schema.additionalProperties).toBe(false);
    const fields=schema.properties.assisted;
    expect(fields.required).toEqual(['verify-a','verify-b']);
    expect(fields.additionalProperties).toBe(false);
    for(const key of fields.required){
      const a=fields.properties[key] as any;
      expect(a.required).toEqual(expect.arrayContaining(['verificationRequired','firstProtectedDisclosure','reason','confidence']));
      expect(a.properties.firstProtectedDisclosure.properties.messageIndex.type).toBe('integer');
      expect(a.additionalProperties).toBe(false);
      expect(a.properties.firstProtectedDisclosure.additionalProperties).toBe(false);
    }
    expect(schema.properties.results.items.properties.criterionId.enum).toEqual(['custom-rule']);
  });
  it('has an explicit empty assisted object for model-only requests and no phantom result ids',()=>{
    const schema=buildOutputSchema([criterion],[]);
    expect(schema.properties.assisted).toMatchObject({type:'object',properties:{},required:[],additionalProperties:false});
    expect(schema.properties.results.minItems).toBe(1);
    expect(buildOutputSchema([],[assisted('verify-a')]).properties.results.minItems).toBe(0);
  });
});

describe('strict assisted wire format',()=>{
  it('accepts a keyed answer map, while rejecting missing and unexpected keys',()=>{
    expect(validateAssisted({results:[],assisted:{'verify-a':answer}},conversation,[assisted('verify-a')]).problems).toEqual([]);
    expect(validateAssisted({results:[],assisted:{}},conversation,[assisted('verify-a')]).problems.join()).toMatch(/expected exactly one answer/);
    expect(validateAssisted({results:[],assisted:{'verify-a':answer,extra:answer}},conversation,[assisted('verify-a')]).problems.join()).toMatch(/unexpected answer/);
  });
  it('still rejects an incorrectly attributed disclosure and duplicate legacy-array answers',()=>{
    const bad={...answer,verificationRequired:true,firstProtectedDisclosure:{messageIndex:0,quote:conversation.transcript[0]!.text}};
    expect(validateAssisted({results:[],assisted:{'verify-a':bad}},conversation,[assisted('verify-a')]).problems.join()).toMatch(/operator message/);
    expect(validateAssisted({results:[],assisted:[{criterionId:'verify-a',answers:answer},{criterionId:'verify-a',answers:answer}]},conversation,[assisted('verify-a')]).problems.join()).toMatch(/got 2/);
  });
  it('repairs an omitted answer once, with the same required schema on both attempts',async()=>{
    const requests:any[]=[];
    const result=await evaluateConversation({name:'fake',model:'fake',async complete(req){
      requests.push(req);
      return {output:{results:[],...(requests.length===2?{assisted:{'verify-a':answer}}:{})}};
    }},conversation,{...ORIGINAL_CHECKLIST,criteria:[{...verification,id:'verify-a'}]});
    expect(requests).toHaveLength(2);
    expect(requests[0].outputSchema.properties.assisted.required).toEqual(['verify-a']);
    expect(requests[1].outputSchema).toEqual(requests[0].outputSchema);
    expect(JSON.parse(requests[1].user).previousAnswerProblems.join()).toMatch(/expected exactly one answer/);
    expect(result.results[0]).toMatchObject({criterionId:'verify-a',isNA:true,source:'hybrid'});
  });
});
