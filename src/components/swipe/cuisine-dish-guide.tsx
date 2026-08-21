"use client";

// Dish glossary below the swipe deck (user feedback: swiping past
// "Vietnamese" with no idea what pho or banh mi actually are). Shows the
// active card's full dish list as a stacked list of small cards -- real
// photo, dish name, one-sentence "what is this" blurb -- reached by
// scrolling down, updating as the deck advances to the next cuisine.
//
// Deliberately not a plain bordered <ul>: a flat divide-y list of 10
// identical rows is the boring default (see the taste-skill guidance this
// was built against). The first dish gets a larger "featured" treatment,
// the rest are compact rows, and each fades/rises in via IntersectionObserver
// as it scrolls into view -- motivated motion (a reveal that matches the act
// of scrolling down to learn more), not decoration. Reduced-motion users get
// this for free: global.css's blanket prefers-reduced-motion override already
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
    <section className="mx-auto mt-10 w-full max-w-sm px-1 md:max-w-2xl">
      <p className="font-body text-[length:var(--fs-t-label)] font-bold uppercase tracking-[var(--fs-tracking-label)] text-muted-foreground">
        Get to know {cuisineName}
      </p>
      <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-[-.02em] text-foreground">
        What&rsquo;s on the menu
      </h2>
      <div className="mt-4 flex flex-col gap-3">
        {dishes.map((dish, i) => (
          <DishEntry key={dish} cuisineId={cuisineId} dishName={dish} featured={i === 0} index={i} />
        ))}
      </div>
    </section>
  );
}

function DishEntry({
  cuisineId,
  dishName,
  featured,
  index,
}: {
  cuisineId: string;
  dishName: string;
  featured: boolean;
  index: number;
}) {
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
      className={`flex gap-4 rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-card transition-all duration-500 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${featured ? "flex-col p-4 sm:flex-row sm:items-center" : "items-center p-3"}`}
      style={{ transitionDelay: visible ? "0ms" : `${Math.min(index, 6) * 70}ms` }}
    >
      <div
        className={`relative shrink-0 overflow-hidden rounded-[var(--fs-r-sm)] bg-[var(--fs-ink)] ${
          featured ? "h-40 w-full sm:h-24 sm:w-24" : "h-14 w-14"
        }`}
      >
        {image ? (
          <img src={image} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <UtensilsCrossed className="h-5 w-5 text-[var(--fs-on-ink)]/70" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        {/* Dish name stays Fraunces, same treatment as the swipe card itself. */}
        <h3 className={`font-headline font-semibold text-foreground ${featured ? "text-lg" : "text-base"}`}>
          {dishName}
        </h3>
        {blurb && <p className="mt-0.5 font-body text-xs leading-snug text-muted-foreground">{blurb}</p>}
      </div>
    </div>
  );
}
