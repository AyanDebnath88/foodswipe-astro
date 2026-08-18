// Design system v2 chip primitive. Two registers, never mixed (see
// _design-import-v2/delivery/design-language-v2.md #5): solid square-radius
// chips on light/card surfaces (mode/distance/sponsored/done), and one glass
// pill register for on-photo use. Replaces the v1 sticker-pill Badge and its
// broken `neon` variant (referenced an undefined --neon-pink).
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap font-display font-bold uppercase",
  {
    variants: {
      variant: {
        // Solid register: rounded-[5px], Archivo 700 9.5px caps, on card/light surfaces.
        mode: "rounded-[var(--fs-r-chip)] bg-[var(--fs-forest)] text-[var(--fs-on-ink)] px-1.5 py-1 text-[length:var(--fs-t-chip)] tracking-[var(--fs-tracking-chip)]",
        distance: "rounded-[var(--fs-r-chip)] bg-[var(--fs-gold)] text-[var(--fs-on-gold)] px-1.5 py-1 text-[length:var(--fs-t-chip)] tracking-[var(--fs-tracking-chip)]",
        sponsored: "rounded-[var(--fs-r-chip)] bg-[var(--fs-cream-tint)] text-[var(--fs-text-3)] px-1.5 py-1 text-[length:var(--fs-t-chip)] tracking-[var(--fs-tracking-chip)]",
        done: "rounded-[var(--fs-r-chip)] bg-[var(--fs-forest-tint)] text-[var(--fs-forest-ink)] px-1.5 py-1 text-[length:var(--fs-t-chip)] tracking-[var(--fs-tracking-chip)]",
        // Glass register: pill radius, 18% white + 6px blur, for use on top of full-bleed photography.
        glass: "rounded-[var(--fs-r-pill)] bg-[var(--fs-glass)] border border-[var(--fs-glass-line)] backdrop-blur-[6px] text-[var(--fs-on-ink)] px-3 py-1.5 text-[length:var(--fs-t-chip)] tracking-[var(--fs-tracking-chip)]",
      },
    },
    defaultVariants: { variant: "glass" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
