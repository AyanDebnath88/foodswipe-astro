// Design-phase Phase C primitive (composed-finding-sutton.md's "Card primitive:
// yes, add one"). ~15 files hand-inline rounded-2xl/border-primary/bg-card
// chrome independently today with slight variance -- this is the one place
// that pattern now lives, same CVA/cn() structure as button.tsx. Adopted in
// match-reveal.tsx's restaurant-results grid first (the plan's named
// example); other hand-inlined surfaces can migrate opportunistically, not
// as a forced pass.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-2xl border text-card-foreground", {
  variants: {
    variant: {
      // The pattern already repeated across rooms-dashboard/match-reveal/
      // feedback-prompt: soft border, translucent card fill, backdrop blur.
      default: "border-primary/15 bg-card/70 backdrop-blur-md",
      // Flat, opaque -- for surfaces that shouldn't show whatever's behind
      // them (e.g. stacked over card photography).
      solid: "border-primary/15 bg-card shadow-sm",
      // Dashed invite/empty-state chrome (find-restaurants prompt, etc).
      dashed: "border-2 border-dashed border-primary/30 bg-card/40",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, className }))} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-headline text-lg leading-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("font-body text-xs text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-2 p-5 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants };
