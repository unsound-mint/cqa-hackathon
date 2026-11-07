import type { CriterionResult } from '@cqa/contracts';
import { z } from 'zod';
import type { DetectorInput } from '../detectors/types.js';

export const Ref = z.strictObject({ messageIndex: z.number().int().nonnegative(), quote: z.string().trim().min(1) });
export type Ref = z.infer<typeof Ref>;
export const Range = z.strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() });
export const common = {
  reason: z.string().trim().min(1), confidence: z.enum(['high', 'medium', 'low']),
};
export type Common = { reason: string; confidence: 'high' | 'medium' | 'low' };
export const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const list = (items: unknown) => ({ type: 'array', items });
// For multi-reference helpers, indices keep the provider grammar compact; code copies exact source text.
export const indexJson = { type: 'integer' };
export const refJson = object({ messageIndex: { type: 'integer' }, quote: { type: 'string' } });
export const commonJson = {
  reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
};
export const choice = (...values: string[]) => ({ type: 'string', enum: values });
export type Input = Omit<DetectorInput, 'criterion'>;

/** Exact references, roles and client visibility are invariants, regardless of the semantic judgment. */
export function referenceProblems(input: Input, range: z.infer<typeof Range>, refs: { ref: Ref; role: 'operator' | 'client' | 'system' }[]): string[] {
  const problems: string[] = [];
  const { conversation, facts } = input;
  if (range.from !== 0 || range.to !== conversation.transcript.length - 1) problems.push('checkedRange must cover the full exchange for semantic facts');
  if (range.from > range.to || range.to >= conversation.transcript.length) problems.push('checkedRange is outside transcript or reversed');
  for (const { ref, role } of refs) {
    const m = conversation.transcript[ref.messageIndex];
    if (!m || m.speaker !== role) problems.push(`message ${ref.messageIndex} must have role ${role}`);
    if (m && !m.text.includes(ref.quote)) problems.push(`quote not found verbatim in message ${ref.messageIndex}`);
    if (role === 'operator' && facts.operatorMessagesDuringHold.includes(ref.messageIndex)) problems.push(`operator message ${ref.messageIndex} is not client-facing`);
    if (ref.messageIndex < range.from || ref.messageIndex > range.to) problems.push(`message ${ref.messageIndex} lies outside checkedRange`);
  }
  return problems;
}
export const fullRange = (input: Input) => ({ from: 0, to: input.conversation.transcript.length - 1 });
export const opRefs = (refs: Ref[]) => refs.map(ref => ({ ref, role: 'operator' as const }));
export const clientRef = (ref: Ref) => ({ ref, role: 'client' as const });
export function before(a: Ref, b: Ref, input: Input): boolean {
  if (a.messageIndex !== b.messageIndex) return a.messageIndex < b.messageIndex;
  const text = input.conversation.transcript[a.messageIndex]?.text ?? '';
  return text.indexOf(a.quote) + a.quote.length <= text.indexOf(b.quote);
}
export function result(input: DetectorInput, a: Common, value: CriterionResult['value'], evidence: Ref[], rule: string): CriterionResult {
  const isNA = value === null;
  return {
    criterionId: input.criterion.id, value, isNA, ...(isNA ? { naReason: a.reason } : {}),
    explanation: `${rule} ${a.reason}`, evidence: [...new Map(evidence.map(e => [`${e.messageIndex}:${e.quote}`, e])).values()],
    checkedRange: fullRange(input), confidence: a.confidence, source: 'hybrid',
  };
}
export const ruleText = (input: DetectorInput, ru: string, kz: string, en: string) => ({ RU: ru, KZ: kz, EN: en })[input.conversation.language];
export function parsed<T>(schema: z.ZodType<T>, raw: unknown, input?: Input): { answers?: T; problems: string[] } {
  const resolve = (value: unknown): unknown => {
    if (typeof value === 'number') return { messageIndex: value, quote: input?.conversation.transcript[value]?.text ?? '' };
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') {
      // Already expanded references are supported for provider-neutral adapters and validated below.
      if ('messageIndex' in value) return value;
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, resolve(v)]));
    }
    return value;
  };
  const p = schema.safeParse(input ? resolve(raw) : raw);
  return p.success ? { answers: p.data, problems: [] } : { problems: p.error.issues.slice(0, 4).map(i => `${i.path.join('.')}: ${i.message}`) };
}
