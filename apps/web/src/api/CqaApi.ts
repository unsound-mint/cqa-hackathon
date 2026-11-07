import type {
  Appeal,
  ChecklistVersion,
  Conversation,
  CreateAppealInput,
  DecideAppealInput,
  Evaluation,
  Job,
  ListConversationsQuery,
  ListEvaluationsQuery,
  SaveChecklistInput,
  StartEvaluationInput,
} from '@cqa/contracts';

/**
 * Service contract between UI and backend. Components depend only on this interface; MockCqaApi
 * (fictional fixture) and a future HttpCqaApi implement it. Route mapping: docs/ARCHITECTURE.md.
 */
export interface CqaApi {
  listConversations(query?: ListConversationsQuery): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation>;
  listEvaluations(query?: ListEvaluationsQuery): Promise<Evaluation[]>;
  getEvaluation(id: string): Promise<Evaluation>;
  listChecklists(): Promise<ChecklistVersion[]>;
  saveChecklistVersion(input: SaveChecklistInput): Promise<ChecklistVersion>;
  startEvaluation(input: StartEvaluationInput): Promise<{ jobId: string }>;
  getJob(id: string): Promise<Job>;
  listAppeals(query: { evaluationId: string }): Promise<Appeal[]>;
  createAppeal(input: CreateAppealInput): Promise<Appeal>;
  decideAppeal(input: DecideAppealInput): Promise<Appeal>;
}

export type CqaApiErrorCode = 'not_found' | 'invalid' | 'conflict';

export class CqaApiError extends Error {
  constructor(
    public readonly code: CqaApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CqaApiError';
  }
}
