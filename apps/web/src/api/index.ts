import { MockCqaApi } from './MockCqaApi';
import type { CqaApi } from './CqaApi';

export * from './CqaApi';
export { MockCqaApi } from './MockCqaApi';

/** Single place that picks the implementation. Swap in HttpCqaApi here for integration; components never change. */
export function createApi(): CqaApi {
  const mode = import.meta.env.VITE_API_MODE ?? 'mock';
  if (mode === 'mock') return new MockCqaApi();
  throw new Error(`VITE_API_MODE=${mode}: HttpCqaApi is not implemented yet (issue S5). Use 'mock'.`);
}
