/** Skeleton with the final layout (sidebar, queue, transcript, verdict), shown while data loads. */
export function LoadingShell() {
  const bar = 'rounded-lg bg-fill motion-safe:animate-pulse';
  return (
    <div role="status" aria-label="Загрузка" className="flex h-full flex-col md:flex-row">
      <span className="sr-only">Загрузка…</span>
      <div aria-hidden className="hidden w-[72px] shrink-0 flex-col items-center gap-4 border-r border-line bg-surface py-4 md:flex">
        <div className={`${bar} h-6 w-10`} />
        <div className={`${bar} h-12 w-12`} />
        <div className={`${bar} h-12 w-12`} />
      </div>
      <div aria-hidden className="grid min-h-0 flex-1 gap-4 bg-canvas p-4 xl:grid-cols-[280px_minmax(0,1fr)_480px]">
        <div className="hidden space-y-3 rounded-card bg-surface p-4 shadow-card xl:block">
          <div className={`${bar} h-10`} />
          {[0, 1, 2, 3].map((i) => <div key={i} className={`${bar} h-16`} />)}
        </div>
        <div className="space-y-4 rounded-card bg-surface p-6 shadow-card">
          <div className={`${bar} h-8 w-1/2`} />
          <div className={`${bar} h-8`} />
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={`${bar} h-16 ${i % 2 ? 'ml-auto w-2/3' : 'w-3/4'}`} />)}
        </div>
        <div className="hidden space-y-4 overflow-hidden rounded-card bg-surface shadow-card xl:block">
          <div className="verdict space-y-3 px-6 py-6"><div className="h-4 w-24 rounded bg-white/10" /><div className="h-14 w-40 rounded bg-white/10" /><div className="h-8 w-48 rounded-full bg-white/10" /></div>
          <div className="space-y-3 px-6 pb-6">
            <div className={`${bar} h-12`} />
            {[0, 1, 2, 3].map((i) => <div key={i} className={`${bar} h-14`} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
