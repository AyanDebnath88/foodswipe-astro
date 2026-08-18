import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Fisher-Yates, non-mutating. Every swipe deck (cuisine/dish/subcuisine) used
 * to hand every room member the exact same catalog order, so the first card
 * anyone ever swiped on was always Italian -- fine for one person, but a
 * room's cards are per-user local state already, so there's no reason they
 * all have to agree on order. Match detection is keyed by id, never by deck
 * position, so shuffling here has zero effect on match correctness.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
