"use client";

// Ported from the reference Next.js project's
// src/components/dishes/dish-card.tsx. Drag/swipe mechanics unchanged.
// Deviation: the reference used a Pollinations.ai prompt built from the dish
// name at render time (an external network dependency with no fallback
// story in this rewrite). Instead, dish photography comes from the static
// shot catalog in src/lib/dish-images.ts: dish.name -> catalog match ->
// specific photo, else the cuisineId's hero shot, else this still falls
// through to the plain icon tile below -- a generative-menu dish that
// matches nothing in the catalog is common (see dish-swipe-area.tsx's
// header comment on where dish names come from) and must never 404.
import React, { useRef, useState } from "react";
import { Sparkles, UtensilsCrossed } from "lucide-react";
import { getDishImage } from "@/lib/dish-images";
import { Badge } from "@/components/ui/badge";

const SWIPE_THRESHOLD = 100;

export interface Dish {
  id: string;
  name: string;
  description?: string;
  isTopPick?: boolean;
}

interface DishCardProps {
  dish: Dish;
  cuisineId: string;
  onSwipe: (direction: "left" | "right") => void;
  isActive: boolean;
  zIndex: number;
}

export function DishCard({ dish, cuisineId, onSwipe, isActive, zIndex }: DishCardProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dishImage = getDishImage(dish.name, cuisineId);
  const kenBurnsVariant = dish.id.length % 2 === 0 ? "a" : "b";

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive) return;
    setIsDragging(true);
    cardRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !isActive) return;
    setPos((currentPos) => ({ x: currentPos.x + e.movementX, y: currentPos.y + e.movementY }));
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
      className={`absolute w-full h-full max-w-sm md:max-w-[var(--fs-card-max)] max-h-72 md:max-h-96 rounded-[var(--fs-r-2xl)] shadow-[var(--fs-e-2)] overflow-hidden bg-[var(--fs-ink)] ${
        isActive ? "cursor-grab" : ""
      } ${animationClass}`}
    >
      <div className="relative w-full h-full flex flex-col">
        {dishImage ? (
          <img
            src={dishImage}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-cover animate-ken-burns-${kenBurnsVariant}`}
            draggable={false}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center select-none">
            <UtensilsCrossed className="h-16 w-16 text-[var(--fs-on-ink)]/90 drop-shadow" aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-0" style={{ background: "var(--fs-scrim-card)" }} />
        <div className="absolute bottom-0 left-0 right-0 p-6 text-[var(--fs-on-ink)]">
          {dish.isTopPick && (
            <Badge variant="glass" className="mb-2">
              <Sparkles className="w-3 h-3" />
              Top Pick
            </Badge>
          )}
          {/* Dish name stays Fraunces -- the one warm, human word on the screen (design-language-v2.md). */}
          <h2 className="font-headline text-[length:var(--fs-t-dish)] font-semibold tracking-[-.015em]">
            {dish.name}
          </h2>
          {dish.description && <p className="text-sm mt-1 text-[var(--fs-on-dark-3)]">{dish.description}</p>}
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
            id="dish-swipe-left-btn"
            className="hidden"
            onClick={() => {
              setExitDirection("left");
              onSwipe("left");
            }}
          />
        )}
        {isActive && (
          <button
            id="dish-swipe-right-btn"
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
