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

  const emoji = CUISINE_EMOJI[cuisine.id] ?? "🍽️";
  const description = CUISINE_DESCRIPTIONS[cuisine.id];
  const heroImage = getCuisineHeroImage(cuisine.id);
  const kenBurnsVariant = cuisine.id.length % 2 === 0 ? "a" : "b";

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive) return;
    setIsDragging(true);
    cardRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !isActive) return;
    setPos((currentPos) => ({
      x: currentPos.x + e.movementX,
      y: currentPos.y + e.movementY,
    }));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !isActive) return;
    setIsDragging(false);
    cardRef.current?.releasePointerCapture(e.pointerId);

    if (pos.x > SWIPE_THRESHOLD) {
      setExitDirection("right");
      onSwipe("right");
    } else if (pos.x < -SWIPE_THRESHOLD) {
      setExitDirection("left");
      onSwipe("left");
    } else {
      setPos({ x: 0, y: 0 });
    }
  };

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
      style={{
        transform,
        transition: isDragging ? "none" : "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        zIndex,
        touchAction: isActive ? "none" : "auto",
      }}
      className={`absolute w-full h-full max-w-sm max-h-[500px] rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-br from-primary/70 via-accent/60 to-secondary/70 ${
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          <h2 className="text-3xl font-headline font-bold">{cuisine.name}</h2>
          {description && <p className="mt-2 text-white/90 text-sm">{description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {cuisine.dishes.slice(0, 5).map((dish) => (
              <Badge key={dish} variant="outline">
                {dish}
              </Badge>
            ))}
          </div>
        </div>
        {isActive && (
          <>
            <div
              className={`absolute top-8 left-8 text-destructive text-2xl font-bold border-2 border-destructive rounded-xl px-4 py-1 transform -rotate-12 transition-opacity ${
                pos.x < -10 ? "opacity-100" : "opacity-0"
              }`}
            >
              NOPE
            </div>
            <div
              className={`absolute top-8 right-8 text-primary text-2xl font-bold border-2 border-primary rounded-xl px-4 py-1 transform rotate-12 transition-opacity bg-black/20 ${
                pos.x > 10 ? "opacity-100" : "opacity-0"
              }`}
            >
              LIKE
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
