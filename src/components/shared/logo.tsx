import { Utensils } from "lucide-react";
import { cn } from "@/lib/utils";

// Ported from the reference Next.js project's src/components/shared/logo.tsx.
// Deviation: next/link's <Link> is replaced with a plain <a> -- this is a
// React island mounted inside an Astro page, not a Next.js app, so there's no
// Next router to hand navigation to.
export function Logo({ className }: { className?: string }) {
  return (
    <a href="/" className="flex items-center gap-2 group">
      <div className="p-2 bg-primary/80 text-primary-foreground rounded-lg group-hover:bg-primary transition-colors">
        <Utensils className="h-6 w-6" />
      </div>
      <span className={cn("text-2xl font-headline font-bold text-foreground", className)}>
        Food Swipe
      </span>
    </a>
  );
}
