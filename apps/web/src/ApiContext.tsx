import { createContext, useContext, type ReactNode } from 'react';
import type { CqaApi } from './api';

const Ctx = createContext<CqaApi | null>(null);

export function ApiProvider({ api, children }: { api: CqaApi; children: ReactNode }) {
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApi(): CqaApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
