import {
  AppealSchema,
  ChecklistVersionSchema,
  ConversationSchema,
  EvaluationSchema,
  JobSchema,
} from '@cqa/contracts';
import type {
  Appeal,
  ChecklistVersion,
  Conversation,
  CreateAppealInput,
  DecideAppealInput,
  Evaluation,
  Job,
  ListAppealsQuery,
  ListConversationsQuery,
  ListEvaluationsQuery,
  OverrideCriterionInput,
  SaveChecklistInput,
  StartEvaluationInput,
} from '@cqa/contracts';
import { CqaApiError, type CqaApi } from './CqaApi';

/** Minimal Zod-compatible shape so this file needs no direct zod dependency. */
interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export interface HttpCqaApiOptions {
  /** Prefix for every path; '' keeps URLs relative (vite proxies /api to the API). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** HTTP implementation of CqaApi against the Fastify routes. Every response is validated with the shared contracts. */
export class HttpCqaApi implements CqaApi {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor({ baseUrl = '', fetch: fetchFn }: HttpCqaApiOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    // Late-bound so `this` is not the api object when calling the browser's fetch.
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  listConversations(query: ListConversationsQuery = {}): Promise<Conversation[]> {
    return this.request('GET', `/api/conversations${qs(query)}`, undefined, ConversationSchema.array());
  }

  getConversation(id: string): Promise<Conversation> {
    return this.request('GET', `/api/conversations/${enc(id)}`, undefined, ConversationSchema);
  }

  listEvaluations(query: ListEvaluationsQuery = {}): Promise<Evaluation[]> {
    return this.request('GET', `/api/evaluations${qs(query)}`, undefined, EvaluationSchema.array());
  }

  getEvaluation(id: string): Promise<Evaluation> {
    return this.request('GET', `/api/evaluations/${enc(id)}`, undefined, EvaluationSchema);
  }

  listChecklists(): Promise<ChecklistVersion[]> {
    return this.request('GET', '/api/checklists', undefined, ChecklistVersionSchema.array());
  }

  saveChecklistVersion(input: SaveChecklistInput): Promise<ChecklistVersion> {
    return this.request('POST', '/api/checklists', input, ChecklistVersionSchema);
  }

  startEvaluation(input: StartEvaluationInput): Promise<{ jobId: string }> {
    const parser: Parser<{ jobId: string }> = {
      safeParse: (d) =>
        typeof d === 'object' && d !== null && typeof (d as { jobId?: unknown }).jobId === 'string' && (d as { jobId: string }).jobId !== ''
          ? { success: true, data: { jobId: (d as { jobId: string }).jobId } }
          : { success: false },
    };
    return this.request('POST', '/api/evaluations', input, parser);
  }

  getJob(id: string): Promise<Job> {
    return this.request('GET', `/api/jobs/${enc(id)}`, undefined, JobSchema);
  }

  listAppeals(query: ListAppealsQuery = {}): Promise<Appeal[]> {
    if (query.evaluationId) {
      return this.request('GET', `/api/evaluations/${enc(query.evaluationId)}/appeals${qs({ status: query.status })}`, undefined, AppealSchema.array()).then((list) => (query.status ? list.filter((a) => a.status === query.status) : list));
    }
    return this.request('GET', `/api/appeals${qs({ status: query.status })}`, undefined, AppealSchema.array());
  }

  createAppeal(input: CreateAppealInput): Promise<Appeal> {
    // The evaluation id travels in the path; the server schema omits it from the body.
    const { evaluationId, ...body } = input;
    return this.request('POST', `/api/evaluations/${enc(evaluationId)}/appeals`, body, AppealSchema);
  }

  decideAppeal(input: DecideAppealInput): Promise<Appeal> {
    const { appealId, ...body } = input;
    return this.request('POST', `/api/appeals/${enc(appealId)}/decision`, body, AppealSchema);
  }

  audioSrc(conversation: Conversation): string | null {
    return conversation.audioUrl ? `${this.baseUrl}/api/conversations/${enc(conversation.id)}/audio` : null;
  }

  overrideCriterion(input: OverrideCriterionInput): Promise<Appeal> {
    const { evaluationId, ...body } = input;
    return this.request('POST', `/api/evaluations/${enc(evaluationId)}/overrides`, body, AppealSchema);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown, parser: Parser<T>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = { method, headers: { accept: 'application/json' } };
    if (body !== undefined) {
      init.headers = { accept: 'application/json', 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch {
      throw new Error(`Network error: ${method} ${path}`);
    }

    const payload: unknown = await res.json().catch(() => undefined);

    if (!res.ok) {
      const detail = serverError(payload);
      const message = detail ?? `${method} ${path} failed with ${res.status}`;
      if (res.status === 404) throw new CqaApiError('not_found', message);
      if (res.status === 400) throw new CqaApiError('invalid', message);
      if (res.status === 409) throw new CqaApiError('conflict', message);
      throw new Error(`${message} (HTTP ${res.status})`);
    }

    const parsed = parser.safeParse(payload);
    if (!parsed.success) throw new CqaApiError('invalid', `Unexpected response shape from ${method} ${path}`);
    return parsed.data;
  }
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

function qs(query: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function serverError(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const e = (payload as { error?: unknown }).error;
  return typeof e === 'string' && e ? e.slice(0, 200) : undefined;
}
