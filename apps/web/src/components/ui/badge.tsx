import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-canvas text-muted ring-1 ring-inset ring-line',
      success: 'bg-brand-soft text-accent',
      danger: 'bg-danger-soft text-danger',
      warn: 'bg-warn-soft text-warn',
      dark: 'bg-brand-dark text-white',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
