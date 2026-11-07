import type { Conversation } from '@cqa/contracts';
import type { ProviderRequest } from '../../src/services/evaluation/provider.js';

/** Valid factual wire responses for safe fixtures; individual semantic decisions are tested separately. */
export function semanticAnswers(req: Pick<ProviderRequest, 'user'>, withDialogueFlaw = false): { criterionId: string; answers: unknown }[] {
  const p = JSON.parse(req.user);
  const t: Conversation['transcript'] = p.conversation.transcript;
  const client = t.find(m => m.speaker === 'client')!;
  const op = t.find(m => m.speaker === 'operator' && m.index > client.index)!;
  const ref = (m: typeof op) => ({ messageIndex: m.index, quote: m.text });
  const common = { reason: 'Safe fixture facts.', confidence: 'high' };
  return (p.assistedQuestions ?? []).flatMap((q: any) => {
    const properties = q.answersSchema.properties;
    let answers: unknown;
    if (properties.missingDetails) answers = { ...common, usedKnownContext: true, missingDetails: [] };
    else if (properties.requests) answers = { ...common, requests: [{ description: client.text, clientRequest: ref(client), materiality: 'main', handling: 'answered', operatorEvidence: [ref(op)] }], incorrectKeyRecommendation: [] };
    else if (properties.forcedClarifications) answers = { ...common, operatorEvidence: [ref(op)], incoherencePreventingUnderstanding: [], forcedClarifications: [], otherCommunicationFlaws: withDialogueFlaw ? [{ operatorWording: ref(op), reason: 'Fixture clarity flaw.' }] : [], waits: [] };
    else return [];
    return [{ criterionId: q.criterionId, answers }];
  });
}
