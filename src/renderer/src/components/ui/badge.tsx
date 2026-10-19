import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary-hover',
        destructive: 'bg-destructive text-destructive-foreground [a&]:hover:bg-destructive-hover',
        outline:
          'border-stroke-3 text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
      },
      /** 语义色：与填充方式正交，给状态胶囊用 */
      tone: {
        default: '',
        info: '',
        warn: '',
        success: '',
        danger: '',
      },
    },
    compoundVariants: [
      /* 描边胶囊：淡色底 + 同族描边与文字 */
      {
        variant: 'outline',
        tone: 'info',
        class: 'border-info-border bg-info-surface text-info-ink',
      },
      {
        variant: 'outline',
        tone: 'warn',
        class: 'border-warn-border bg-warn-surface text-warn-ink',
      },
      {
        variant: 'outline',
        tone: 'success',
        class: 'border-success-border bg-success-surface text-success-ink',
      },
      {
        variant: 'outline',
        tone: 'danger',
        class: 'border-danger-border bg-danger-surface text-danger-ink',
      },
      /* 实心胶囊：同族 ink 当底色，文字取反相色 */
      { variant: 'default', tone: 'info', class: 'bg-info-ink text-primary-foreground' },
      { variant: 'default', tone: 'warn', class: 'bg-warn-ink text-primary-foreground' },
      { variant: 'default', tone: 'success', class: 'bg-success-ink text-primary-foreground' },
      { variant: 'default', tone: 'danger', class: 'bg-danger-ink text-primary-foreground' },
    ],
    defaultVariants: {
      variant: 'default',
      tone: 'default',
    },
  }
);

function Badge({
  className,
  variant = 'default',
  tone = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, tone }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
