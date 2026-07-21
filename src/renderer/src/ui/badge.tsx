import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

/**
 * shadcn/ui Badge — Rockury 리테마 + DB 키/제약 variant.
 *   generic: default · secondary · outline · destructive
 *   DB 키  : pk(테라코타) · fk(시안) · uk(인포) · idx(뉴트럴) · check(석세스)
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'border-input text-foreground',
        pk: 'border-transparent bg-accent-2-soft font-mono tracking-wide text-accent-2',
        fk: 'border-transparent bg-accent-soft font-mono tracking-wide text-accent',
        uk: 'border-transparent bg-info-soft font-mono tracking-wide text-info',
        idx: 'border-transparent bg-panel-strong font-mono tracking-wide text-muted',
        check: 'border-transparent bg-success-soft font-mono tracking-wide text-success'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

// forwardRef — Radix asChild(HoverCardTrigger 등)의 앵커가 되려면 ref 전달 필수(React 18).
const Badge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }
>(({ className, variant, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={ref} data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  )
})
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
