import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control = 'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm placeholder:text-muted disabled:bg-canvas disabled:text-muted';

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-10', className)} {...p} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20 py-2 leading-relaxed', className)} {...p} />;
}
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, 'h-10', className)} {...p} />;
}

/** Label + control + optional hint/error, wired with htmlFor so screen readers and tests find the control by its label. */
export function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
