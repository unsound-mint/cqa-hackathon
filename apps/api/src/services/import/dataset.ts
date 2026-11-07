import { ConversationSchema, type Conversation } from '@cqa/contracts';
import { z } from 'zod';

/** Organizer envelope. Records are validated one by one so a single bad record cannot sink the import. */
const EnvelopeSchema = z.object({
  isSuccess: z.boolean().optional(),
  error: z.unknown().optional(),
  data: z.object({ dataset_group_id: z.string().optional(), records: z.array(z.unknown()) }),
});

const RawRecordSchema = z.object({
  conversation_id: z.string(),
  channel: z.string(),
  language: z.string(),
  audio_url: z.string().nullable().optional(),
  transcript: z.array(z.object({ timestamp: z.string(), speaker: z.string(), text: z.string() })),
});

export type ParsedDataset = {
  conversations: Conversation[];
  failed: { recordIndex: number; conversationId?: string; reason: string }[];
  total: number;
};

/**
 * Raw organizer JSON -> Conversations. Order, text, speaker and timestamp are kept exactly; only the
 * zero-based `index` is added. Never fabricates or normalizes content; a record that does not fit the
 * contract is reported, not repaired.
 */
export function parseDataset(json: unknown, groupId: string): ParsedDataset {
  const env = EnvelopeSchema.safeParse(json);
  if (!env.success) throw new Error('dataset response does not have data.records[]');
  if (env.data.isSuccess === false) throw new Error('dataset provider reported isSuccess=false');

  const conversations: Conversation[] = [];
  const failed: ParsedDataset['failed'] = [];
  const seen = new Set<string>();
  env.data.data.records.forEach((rec, recordIndex) => {
    const raw = RawRecordSchema.safeParse(rec);
    if (!raw.success) {
      failed.push({ recordIndex, reason: `malformed record: ${raw.error.issues[0]?.path.join('.') ?? ''}` });
      return;
    }
    const r = raw.data;
    const candidate = {
      id: r.conversation_id,
      datasetGroupId: env.data.data.dataset_group_id ?? groupId,
      language: r.language,
      channel: r.channel,
      audioUrl: r.audio_url ?? null,
      transcript: r.transcript.map((m, index) => ({ index, timestamp: m.timestamp, speaker: m.speaker, text: m.text })),
    };
    const parsed = ConversationSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      failed.push({ recordIndex, conversationId: r.conversation_id, reason: `${issue?.path.join('.')}: ${issue?.message}` });
    } else if (seen.has(parsed.data.id)) {
      failed.push({ recordIndex, conversationId: r.conversation_id, reason: 'duplicate conversation_id in response' });
    } else {
      seen.add(parsed.data.id);
      conversations.push(parsed.data);
    }
  });
  return { conversations, failed, total: env.data.data.records.length };
}
