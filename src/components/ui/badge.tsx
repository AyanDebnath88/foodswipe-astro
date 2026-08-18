// Design-phase Phase C primitive, paired with card.tsx. Sticker-shaped pill
// badges are part of the Hongdae-derived celebration language ("Top Pick"),
// but the shape shows up everywhere (dish chips, "Sponsored", host/guest
// tags) hand-inlined with slightly different classes each time -- this is
// the one definition. `neon` variant is the celebration-scope exception:
// only meaningful inside .match-reveal-scope (see global.css), reads as a
// plain pink pill outside it since --neon-pink is undefined there.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-secondary/80 text-secondary-foreground",
        outline: "bg-white/20 text-white backdrop-blur-sm",
        accent: "bg-accent text-accent-foreground uppercase text-[10px] tracking-wide px-2 py-0.5",
        neon: "bg-[var(--neon-pink)] text-white shadow-[0_0_16px_var(--neon-pink)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
