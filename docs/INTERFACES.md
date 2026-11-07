# Shared interface freeze: v0

**Owner: Denis.** This is the initial contract for bootstrap, not a substitute for the Zod schemas / TypeScript types published in `packages/contracts`. Publish those types on `main` before Sofia begins. Change shared shapes via a small `area:shared` issue and version the change; do not allow independently invented frontend/backend DTOs.

## Domain records

```ts
type Speaker = 'client' | 'operator' | 'bot' | 'system';
type Language = 'RU' | 'KZ' | 'EN';
type Channel = 'agent chat' | 'voice call';

type TranscriptMessage = {
  index: number;       // 0-based original array index; stable and unique in conversation
  timestamp: string;   // preserve original MM:SS or ISO timestamp; never reformat
  speaker: Speaker;
  text: string;
};

type Conversation = {
  id: string;          // original conversation_id
  datasetGroupId: string;
  language: Language;
  channel: Channel;
  transcript: TranscriptMessage[];
  audioUrl: string | null;
};

type CriterionKind = 'boolean' | 'discrete-scale' | 'enum';
type Criterion = {
  id: string;
  title: string;
  sectionId?: string;
  instructions: string;
  weight: number;                // 0 for flag-only criterion
  kind: CriterionKind;
  allowedValues: (boolean | number | string)[];
  allowNA: boolean;
  naCondition?: string;
  criticalFlag?: boolean;
};

type ChecklistVersion = {
  id: string;
  version: number;
  title: string;
  sections?: { id: string; title: string }[];
  criteria: Criterion[];
  createdAt: string;
};

type EvidenceReference = {
  messageIndex: number;
  quote?: string;                 // if provided, must occur in that message
};

type CriterionResult = {
  criterionId: string;
  value: boolean | number | string | null;
  isNA: boolean;
  naReason?: string;
  explanation: string;
  evidence: EvidenceReference[];
  checkedRange?: { from: number; to: number }; // inclusive, original indices
};

type Evaluation = {
  id: string;
  conversationId: string;
  checklistVersionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  originalResults: CriterionResult[];
  originalTotal: number | null;
  finalResults: CriterionResult[];
  finalTotal: number | null;
  seriousViolation: boolean;
  error?: string;
};

type Appeal = {
  id: string;
  evaluationId: string;
  criterionId: string;
  comment: string;
  status: 'pending' | 'upheld' | 'overridden';
  reviewerReason?: string;
  reviewerValue?: boolean | number | string | null;
  reviewerIsNA?: boolean;
};
```

**Validation invariants:** exactly one of `isNA` or valid `value`; for `isNA=true`, `value=null` and criterion permits N/A; `checkedRange` indices are within the full, unfiltered original transcript; `evidence` indices are valid; quoted text matches its source; critical errors are separate flags, not score penalties. Section subtotals can be derived from the criteria. If no weighted criteria apply, total is null.

The specific `allowedValues` for the original rubric must match `docs/RUBRIC.md`. For a changed/added criterion, `instructions`, score type, scale, N/A and weight come from stored checklist configuration, not an `id`-based switch.

## Frontend service contract

```ts
interface CqaApi {
  listConversations(query?: { language?: Language; channel?: Channel }): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation>;
  getEvaluation(id: string): Promise<Evaluation>;
  listChecklists(): Promise<ChecklistVersion[]>;
  saveChecklistVersion(input: Omit<ChecklistVersion, 'id'|'version'|'createdAt'>): Promise<ChecklistVersion>;
  startEvaluation(input: { conversationIds: string[]; checklistVersionId: string }): Promise<{ jobId: string }>;
  getJob(id: string): Promise<{ status: 'pending'|'running'|'completed'|'failed'; completed: number; total: number }>;
  createAppeal(input: { evaluationId: string; criterionId: string; comment: string }): Promise<Appeal>;
  decideAppeal(input: { appealId: string; action: 'uphold'|'override'; reason: string; value?: CriterionResult['value']; isNA?: boolean }): Promise<Appeal>;
}
```

The **same** interface must have `MockCqaApi` (fictional in-repo fixture) and `HttpCqaApi` (Fastify REST). Sofia can work exclusively with `MockCqaApi`; Denis implements the HTTP endpoints. If backend pagination or additional metadata becomes necessary, add it compatibly rather than breaking the working mock.

## Initial API mapping

| Service operation | Suggested HTTP route |
|---|---|
| listConversations | `GET /api/conversations` |
| getConversation | `GET /api/conversations/:id` |
| getEvaluation | `GET /api/evaluations/:id` |
| listChecklists | `GET /api/checklists` |
| saveChecklistVersion | `POST /api/checklists` |
| startEvaluation | `POST /api/evaluations` |
| getJob | `GET /api/jobs/:id` |
| createAppeal | `POST /api/evaluations/:id/appeals` |
| decideAppeal | `POST /api/appeals/:id/decision` |

The import endpoint `POST /api/datasets/import` is a backend-only operation that uses an environment-configured signed URL for organizers' DEV/control group. Do not expose the signed URL to the browser.

## Integration checkpoint

Denis announces the commit SHA where `packages/contracts` and the fictional `MockCqaApi` are ready. Sofia works against those without needing Fastify. When the HTTP API matches this service interface, Sofia switches the implementation behind an injected client; components should not import backend services or call `fetch()` directly. Report any mismatch as an issue with an exact example request and response.
