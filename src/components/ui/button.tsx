import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--fs-r-md)] text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--fs-terracotta-hover)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "rounded-[var(--fs-r-pill)] border-[1.5px] border-[var(--fs-line-strong)] bg-transparent text-foreground hover:bg-[var(--fs-cream-tint)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // The one CTA shape (design-language-v2.md #4): ink pill + terracotta
        // arrow circle. Sizing/shape lives in the compound variant below so
        // it wins over whatever `size` is passed. Use with a CtaArrow child:
        //   <Button variant="cta" asChild><a href="/rooms"><span>Start swiping</span><CtaArrow /></a></Button>
        cta: "bg-[var(--fs-ink)] text-[var(--fs-on-ink)] font-semibold shadow-[var(--fs-e-float)] hover:shadow-[var(--fs-e-primary)] group",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-[var(--fs-r-sm)] px-3",
        lg: "h-11 rounded-[var(--fs-r-md)] px-8",
        icon: "h-10 w-10",
      },
    },
    compoundVariants: [
      {
        variant: "cta",
        class:
          "rounded-[var(--fs-r-pill)] h-[var(--fs-cta-h)] w-full pl-[22px] pr-1.5 justify-between gap-3",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

/**
 * The terracotta arrow circle that pairs with `variant="cta"`. 46px, grows to
 * 50px on hover of the enclosing `group` (the CTA button itself). Icon-only
 * fill (--fs-terracotta), never a text-label color, per tokens-v2.css's own
 * contrast note.
 */
function CtaArrow({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-[var(--fs-cta-arrow)] w-[var(--fs-cta-arrow)] shrink-0 items-center justify-center rounded-full bg-[var(--fs-terracotta)] text-[var(--fs-on-ink)] transition-[height,width] duration-150 group-hover:h-[50px] group-hover:w-[50px]",
        className
      )}
    >
      <ArrowRight className="h-[18px] w-[18px]" />
    </span>
  );
}

export { Button, buttonVariants, CtaArrow };
