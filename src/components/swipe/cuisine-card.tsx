"use client";

// Ported from the reference Next.js project's
// src/components/swipe/cuisine-card.tsx. Drag/pointer-capture mechanics and
// the swipe-threshold logic are unchanged. Deviations:
//   - next/image is replaced with a plain <img> against the editorial hero
//     shot from public/images/cuisines/<id>.jpg (see src/lib/dish-images.ts),
//     with a Ken Burns pan/zoom (src/styles/global.css) instead of Next's
//     built-in image optimizer. Cuisine imagery was deferred at
//     0002_seed_cuisines.sql time and has since landed (see
//     public/images/ASSET-PROMPTS.md) -- the emoji is kept as a small badge
//     rather than removed outright, since a handful of cuisine ids (mainly
//     AI-suggested ones with no catalog row) still have no hero shot.
//   - Cuisine type comes from src/lib/cuisines.ts (Supabase-backed) instead
//     of the reference's static array; `description` is looked up from
//     CUISINE_DESCRIPTIONS by id since it isn't part of the schema.
import React, { useRef, useState } from "react";
import { CUISINE_DESCRIPTIONS, CUISINE_EMOJI, type Cuisine } from "@/lib/cuisines";
import { getCuisineHeroImage } from "@/lib/dish-images";
import { Badge } from "@/components/ui/badge";

const SWIPE_THRESHOLD = 100;

interface CuisineCardProps {
  cuisine: Cuisine;
  onSwipe: (direction: "left" | "right") => void;
  isActive: boolean;
  zIndex: number;
}

export function CuisineCard({ cuisine, onSwipe, isActive, zIndex }: CuisineCardProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Absolute pointer origin at grab time. Tracking deltas from this is
  // reliable on touch where e.movementX is frequently 0 or coalesced -- the
  // old accumulate-movementX approach was the "non-responsive" bug.
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const emoji = CUISINE_EMOJI[cuisine.id] ?? "🍽️";
  const description = CUISINE_DESCRIPTIONS[cuisine.id];
  const heroImage = getCuisineHeroImage(cuisine.id);
  const kenBurnsVariant = cuisine.id.length % 2 === 0 ? "a" : "b";

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    cardRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !isActive || !startRef.current) return;
    setPos({ x: e.clientX - startRef.current.x, y: e.clientY - startRef.current.y });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!isDragging) return;
    setIsDragging(false);
    startRef.current = null;
    try {
      cardRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone on cancel */
    }

    if (commit && pos.x > SWIPE_THRESHOLD) {
      setExitDirection("right");
      onSwipe("right");
    } else if (commit && pos.x < -SWIPE_THRESHOLD) {
      setExitDirection("left");
      onSwipe("left");
    } else {
      setPos({ x: 0, y: 0 });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, true);
  // A cancelled gesture (scroll takeover, focus loss) must reset, or the card
  // freezes mid-drag and stops responding.
  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, false);

  const rotation = pos.x / 20;
  const transform = `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${isDragging ? 1.05 : 1})`;

  let animationClass = "";
  if (exitDirection === "left") animationClass = "animate-swipe-out-left";
  if (exitDirection === "right") animationClass = "animate-swipe-out-right";

  return (
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        transform,
        transition: isDragging ? "none" : "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        zIndex,
        touchAction: isActive ? "none" : "auto",
      }}
      className={`absolute w-full h-full max-w-sm md:max-w-[var(--fs-card-max)] max-h-[500px] md:max-h-[540px] rounded-[var(--fs-r-2xl)] overflow-hidden shadow-[var(--fs-e-2)] bg-[var(--fs-ink)] ${
        isActive ? "cursor-grab" : ""
      } ${animationClass}`}
    >
      <div className="relative w-full h-full flex flex-col">
        {heroImage ? (
          <img
            src={heroImage}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-cover animate-ken-burns-${kenBurnsVariant}`}
            draggable={false}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center select-none">
            <span className="text-[7rem] drop-shadow-lg" aria-hidden="true">
              {emoji}
            </span>
          </div>
        )}
        <div className="absolute inset-0" style={{ background: "var(--fs-scrim-card)" }} />
        <div className="absolute bottom-0 left-0 right-0 p-6 text-[var(--fs-on-ink)]">
          <h2 className="font-display text-[34px] font-extrabold uppercase leading-[0.95] tracking-[-.03em]">
            {cuisine.name}
          </h2>
          {description && <p className="mt-2 text-[var(--fs-on-dark-3)] text-sm">{description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {cuisine.dishes.slice(0, 5).map((dish) => (
              <Badge key={dish} variant="glass">
                {dish}
              </Badge>
            ))}
          </div>
        </div>
        {isActive && (
          <>
            <div
              className={`absolute top-8 left-8 text-[var(--fs-on-ink)] text-2xl font-display font-extrabold uppercase border-2 border-[var(--fs-destructive)] bg-[var(--fs-destructive)]/80 rounded-[var(--fs-r-sm)] px-4 py-1 transform -rotate-12 transition-opacity ${
                pos.x < -10 ? "opacity-100" : "opacity-0"
              }`}
            >
              Nope
            </div>
            <div
              className={`absolute top-8 right-8 text-[var(--fs-on-ink)] text-2xl font-display font-extrabold uppercase border-2 border-[var(--fs-terracotta)] bg-[var(--fs-terracotta)]/80 rounded-[var(--fs-r-sm)] px-4 py-1 transform rotate-12 transition-opacity ${
                pos.x > 10 ? "opacity-100" : "opacity-0"
              }`}
            >
              Like
            </div>
          </>
        )}
        {isActive && (
          <button
            id="cuisine-swipe-left-btn"
            className="hidden"
            onClick={() => {
              setExitDirection("left");
              onSwipe("left");
            }}
          />
        )}
        {isActive && (
          <button
            id="cuisine-swipe-right-btn"
            className="hidden"
            onClick={() => {
              setExitDirection("right");
              onSwipe("right");
            }}
          />
        )}
      </div>
    </div>
  );
}
