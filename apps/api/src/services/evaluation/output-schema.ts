import type { Criterion } from '@cqa/contracts';
import type { AssistedItem } from './evaluator.js';

/** Strict tools require closed objects, including nested detector-provided answer schemas. */
function closeObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(closeObjects);
  if (!value || typeof value !== 'object') return value;
  const schema = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, closeObjects(child)]));
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) schema.additionalProperties = false;
  return schema;
}

/**
 * The wire format must require all work planned for this request. Required object keys enforce exactly
 * one assisted answer per id; strict arrays cannot enforce coverage of multiple different ids.
 * Values, roles and verbatim evidence are still checked by the evaluator, never trusted from the grammar.
 */
export function buildOutputSchema(criteria: readonly Criterion[], assisted: readonly AssistedItem[]) {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        minItems: criteria.length ? 1 : 0,
        description: `Exactly one result per open criterion: ${JSON.stringify(criteria.map(c => c.id))}. No other results.`,
        items: {
          type: 'object',
          properties: {
            criterionId: { type: 'string', ...(criteria.length ? { enum: criteria.map(c => c.id) } : {}) },
            value: { enum: [...new Set(criteria.flatMap(c => c.allowedValues)), null] },
            isNA: { type: 'boolean' },
            naReason: { type: 'string', description: 'Explain the applicability condition when isNA=true; otherwise use an empty string.' },
            explanation: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            decisionBasis: { type: 'string', enum: ['operator_action', 'absence'] },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: { messageIndex: { type: 'integer' }, quote: { type: 'string' } },
                required: ['messageIndex', 'quote'],
                additionalProperties: false,
              },
            },
            checkedRange: {
              type: 'object',
              properties: { from: { type: 'integer' }, to: { type: 'integer' } },
              required: ['from', 'to'],
              additionalProperties: false,
              description: 'Inclusive original message indices inspected for this decision, including absence claims.',
            },
          },
          required: ['criterionId', 'value', 'isNA', 'naReason', 'explanation', 'confidence', 'evidence', 'checkedRange'],
          additionalProperties: false,
        },
      },
      assisted: {
        type: 'object',
        description: 'Required narrow answers for code-decided criteria. Use each criterion id as its key, not as a scored result.',
        properties: Object.fromEntries(assisted.map(({ criterion, detector }) => [criterion.id, closeObjects(detector.answersJsonSchema) as Record<string, unknown>])),
        required: assisted.map(({ criterion }) => criterion.id),
        additionalProperties: false,
      },
    },
    required: ['results', 'assisted'],
    additionalProperties: false,
  };
}
