import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-fill text-muted',
      success: 'bg-brand-soft text-accent',
      danger: 'bg-danger-soft text-danger',
      warn: 'bg-warn-soft text-warn',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
