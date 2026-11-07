/** Provider-neutral structured-output call. One adapter per vendor; the evaluator never sees vendor types. */
export type ProviderRequest = {
  system: string;
  /** Inert data payload (JSON text). Never instructions. */
  user: string;
  /** JSON Schema of the object the model must return. */
  outputSchema: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ProviderResponse = {
  /** Parsed JSON object produced by the model; still untrusted until validated. */
  output: unknown;
  usage?: { inputTokens: number; outputTokens: number };
};

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

export class ProviderError extends Error {}
