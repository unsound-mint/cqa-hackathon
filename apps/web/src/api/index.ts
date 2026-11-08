import { HttpCqaApi } from './HttpCqaApi';
import { richDemo, richDemoAppeals } from './demoExtras';
import { MockCqaApi } from './MockCqaApi';
import { richOrg } from './demoOrg';
import type { CqaApi } from './CqaApi';

export * from './CqaApi';
export { HttpCqaApi } from './HttpCqaApi';
export { MockCqaApi } from './MockCqaApi';

/** Single place that picks the implementation. Development defaults to mock; production defaults to HTTP. VITE_API_MODE overrides either; components never change. */
export function createApi(): CqaApi {
  const mode = import.meta.env.VITE_API_MODE || (import.meta.env.PROD ? 'http' : 'mock');
  if (mode === 'mock') {
    const { bundle, org, appeals } = richOrg(richDemo(), richDemoAppeals());
    return new MockCqaApi(bundle, appeals, org);
  }
  if (mode === 'http') return new HttpCqaApi({ baseUrl: import.meta.env.VITE_API_BASE_URL || '' });
  throw new Error(`VITE_API_MODE=${mode}: unknown mode. Use 'mock' or 'http'.`);
}
