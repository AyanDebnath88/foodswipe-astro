"use client";

// Ported from the reference Next.js project's
// src/components/dishes/dish-card.tsx. Drag/swipe mechanics unchanged.
// Deviation: no per-dish AI-generated photography (the reference used a
// Pollinations.ai prompt built from the dish name, an external network
// dependency with no fallback story in this rewrite) -- a plain icon tile
// stands in, consistent with CuisineCard's same call for cuisine artwork.
import React, { useRef, useState } from "react";
import { Sparkles, UtensilsCrossed } from "lucide-react";

const SWIPE_THRESHOLD = 100;

export interface Dish {
  id: string;
  name: string;
  description?: string;
  isTopPick?: boolean;
}

interface DishCardProps {
  dish: Dish;
  onSwipe: (direction: "left" | "right") => void;
  isActive: boolean;
  zIndex: number;
}

export function DishCard({ dish, onSwipe, isActive, zIndex }: DishCardProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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
      className={`absolute w-full h-full max-w-sm max-h-72 rounded-2xl shadow-2xl overflow-hidden bg-gradient-to-br from-accent/70 via-primary/60 to-secondary/70 ${
        isActive ? "cursor-grab" : ""
      } ${animationClass}`}
    >
      <div className="relative w-full h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center select-none">
          <UtensilsCrossed className="h-16 w-16 text-white/90 drop-shadow" aria-hidden="true" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          {dish.isTopPick && (
            <span className="inline-flex items-center gap-1 text-xs bg-secondary/80 text-secondary-foreground backdrop-blur-sm border-0 rounded-full px-2.5 py-1 mb-2">
              <Sparkles className="w-3 h-3" />
              Top Pick
            </span>
          )}
          <h2 className="text-3xl font-headline font-bold">{dish.name}</h2>
          {dish.description && <p className="text-sm mt-1 text-white/90">{dish.description}</p>}
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
