import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-dark text-white hover:bg-[#0f3326]',
        outline: 'border border-line-strong bg-surface text-ink hover:bg-brand-soft',
        ghost: 'text-ink hover:bg-brand-soft',
        accent: 'bg-brand font-semibold text-[#0e151c] shadow-[0_8px_24px_-6px_rgb(2_177_64/0.55)] hover:bg-[#09c04a]',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-4', lg: 'h-11 px-6' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: Props) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(button({ variant, size }), className)} {...props} />;
}
