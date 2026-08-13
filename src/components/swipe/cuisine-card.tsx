"use client";

// Ported from the reference Next.js project's
// src/components/swipe/cuisine-card.tsx. Drag/pointer-capture mechanics and
// the swipe-threshold logic are unchanged. Deviations:
//   - next/image is replaced with a plain emoji + gradient tile (see
//     src/lib/cuisines.ts's CUISINE_EMOJI comment for why: cuisine imagery
//     was explicitly deferred to a later phase in 0002_seed_cuisines.sql).
//   - Cuisine type comes from src/lib/cuisines.ts (Supabase-backed) instead
//     of the reference's static array; `description` is looked up from
//     CUISINE_DESCRIPTIONS by id since it isn't part of the schema.
import React, { useRef, useState } from "react";
import { CUISINE_DESCRIPTIONS, CUISINE_EMOJI, type Cuisine } from "@/lib/cuisines";

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
        <div className="flex-1 flex items-center justify-center select-none">
          <span className="text-[7rem] drop-shadow-lg" aria-hidden="true">
            {emoji}
          </span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          <h2 className="text-3xl font-headline font-bold">{cuisine.name}</h2>
          {description && <p className="mt-2 text-white/90 text-sm">{description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {cuisine.dishes.slice(0, 5).map((dish) => (
              <span
                key={dish}
                className="text-xs bg-white/20 text-white backdrop-blur-sm border-0 rounded-full px-2.5 py-1"
              >
                {dish}
              </span>
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
