"use client";

// Dish glossary for the swipe deck (user feedback: swiping past
// "Vietnamese" with no idea what pho or banh mi actually are). Real photo,
// dish name, one-sentence "what is this" blurb, per dish in the active
// cuisine's list. Rendered as a sibling column by swipe-area.tsx, not nested
// inside the card.
//
// Two distinct layouts, not one shrunk to fit both (user feedback, second
// pass):
//   - Desktop (lg+): a right-side rail beside the sticky swipe card. Every
//     entry gets the large image-on-top treatment -- the "featured" size
//     the first entry used to get alone -- since the rail has the width to
//     spare and a page split in two columns reads better with visual parity
//     down the list than one hero item followed by nine compact rows.
//   - Mobile: unchanged compact row list (already reviewed as fine), just a
//     bigger thumbnail and the blurb clamped to one line -- there isn't
//     room for ten paragraphs before the next cuisine's worth of scrolling.
//
// Deliberately not a plain bordered <ul>: a flat divide-y list of 10
// identical rows is the boring default (see the taste-skill guidance this
// was built against). Each entry fades/rises in via IntersectionObserver as
// it scrolls into view -- motivated motion (a reveal that matches the act of
// scrolling to learn more), not decoration. Reduced-motion users get this
// for free: global.css's blanket prefers-reduced-motion override already
// collapses every transition-duration to near-zero.
import { useEffect, useRef, useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import { getDishImage } from "@/lib/dish-images";
import { getDishBlurb } from "@/lib/dish-glossary";

export interface CuisineDishGuideProps {
  cuisineId: string;
  cuisineName: string;
  dishes: string[];
}

export function CuisineDishGuide({ cuisineId, cuisineName, dishes }: CuisineDishGuideProps) {
  if (dishes.length === 0) return null;

  return (
    <section className="w-full px-1">
      <p className="font-body text-[length:var(--fs-t-label)] font-bold uppercase tracking-[var(--fs-tracking-label)] text-muted-foreground">
        Get to know {cuisineName}
      </p>
      <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-[-.02em] text-foreground">
        What&rsquo;s on the menu
      </h2>
      <div className="mt-4 flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
        {dishes.map((dish, i) => (
          <DishEntry key={dish} cuisineId={cuisineId} dishName={dish} index={i} />
        ))}
      </div>
    </section>
  );
}

function DishEntry({ cuisineId, dishName, index }: { cuisineId: string; dishName: string; index: number }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const image = getDishImage(dishName, cuisineId);
  const blurb = getDishBlurb(dishName);

  return (
    <div
      ref={ref}
      className={`flex items-center gap-4 rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-card p-3 transition-all duration-500 lg:flex-col lg:items-stretch lg:gap-0 lg:p-0 lg:overflow-hidden lg:border-[var(--fs-line)] ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
      style={{ transitionDelay: visible ? "0ms" : `${Math.min(index, 6) * 70}ms` }}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[var(--fs-r-sm)] bg-[var(--fs-ink)] lg:h-40 lg:w-full lg:rounded-none">
        {image ? (
          <img src={image} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <UtensilsCrossed className="h-6 w-6 text-[var(--fs-on-ink)]/70" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="min-w-0 lg:p-4">
        {/* Dish name stays Fraunces, same treatment as the swipe card itself. */}
        <h3 className="font-headline text-base font-semibold text-foreground lg:text-lg">{dishName}</h3>
        {blurb && (
          <p className="mt-0.5 line-clamp-1 font-body text-xs leading-snug text-muted-foreground lg:line-clamp-2 lg:text-sm">
            {blurb}
          </p>
        )}
      </div>
    </div>
  );
}
