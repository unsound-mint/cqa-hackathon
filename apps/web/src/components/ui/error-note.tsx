import { humanError } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** An error in the reviewer's language; the original message stays one click away for debugging. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (error === null || error === undefined || error === '') return null;
  const { text, detail } = humanError(error);
  return (
    <div role="alert" className={cn('text-sm text-danger', className)}>
      {text}
      {detail && (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer select-none hover:text-ink">Подробности</summary>
          <span className="break-words">{detail}</span>
        </details>
      )}
    </div>
  );
}
