"use client";

// Phase 4 — solo value, half two: saved restaurants (/favorites).
//
// `saved_restaurants` is the only table in this schema that isn't
// room-scoped (0014 block B): it's the user's own list, it outlives every
// room, and nobody else can read a row of it. So this page needs no room, no
// participants and no Realtime — it is the app's one genuinely solo surface,
// which is the gap this phase exists to close.
//
// Manual add is here on purpose. Saving from a room is the common path (the
// history page's "Save <restaurant>" button), but a favourites list you can
// only fill by having a group session first isn't a solo feature at all.
import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  NAME_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  fetchFavorites,
  removeFavorite,
  saveFavorite,
  updateFavoriteNotes,
  type SavedRestaurant,
} from "@/lib/favorites";
import { relativeTime } from "@/lib/history";
import { Heart, Loader2, Plus, Trash2, ExternalLink, Pencil, Check, X } from "lucide-react";

export function FavoritesView() {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<SavedRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setFavorites(await fetchFavorites());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        window.location.href = "/login";
        return;
      }
      setUserId(user.id);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userId || newName.trim() === "") return;
    setAdding(true);
    try {
      await saveFavorite({ userId, restaurantName: newName });
      setNewName("");
      await load();
      toast({ title: "Saved" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't save that",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (favorite: SavedRestaurant) => {
    setBusyId(favorite.id);
    try {
      await removeFavorite(favorite.id);
      setFavorites((prev) => prev.filter((f) => f.id !== favorite.id));
      toast({ title: "Removed", description: `${favorite.restaurantName} is no longer saved.` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't remove that",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveNote = async (favorite: SavedRestaurant) => {
    setBusyId(favorite.id);
    try {
      await updateFavoriteNotes(favorite.id, noteDraft);
      setFavorites((prev) =>
        prev.map((f) =>
          f.id === favorite.id ? { ...f, notes: noteDraft.trim() === "" ? null : noteDraft.trim() } : f
        )
      );
      setEditingId(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't save that note",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto flex min-h-[50vh] items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="inline-flex items-center gap-2 font-headline text-3xl font-bold text-foreground">
          <Heart className="h-7 w-7 fill-primary text-primary" /> Saved places
        </h1>
        <p className="mt-1 font-body text-muted-foreground">
          Yours alone — nobody in your rooms can see this list.
        </p>
      </header>

      <form onSubmit={handleAdd} className="mb-8 flex flex-wrap gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value.slice(0, NAME_MAX_LENGTH))}
          placeholder="Add a place by name…"
          aria-label="Restaurant name"
          maxLength={NAME_MAX_LENGTH}
          className="min-w-[16rem] flex-1"
        />
        <Button type="submit" disabled={adding || newName.trim() === ""}>
          {adding ? <Loader2 className="animate-spin" /> : <Plus />} Save
        </Button>
      </form>

      {favorites.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-black/10 bg-card/50 p-10 text-center">
          <Heart className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-headline text-lg font-semibold text-foreground">
            No saved places yet
          </p>
          <p className="mx-auto mt-1 max-w-sm font-body text-sm text-muted-foreground">
            Add one above, or save the places your group agreed on from your room history.
          </p>
          <a
            href="/history"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md border border-input px-4 font-body text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Your rooms
          </a>
        </div>
      ) : (
        <ul className="space-y-3">
          {favorites.map((favorite) => (
            <li
              key={favorite.id}
              className="rounded-2xl border border-black/5 bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-headline text-lg font-semibold text-foreground">
                    {favorite.restaurantName}
                  </p>
                  <p className="mt-0.5 font-body text-xs text-muted-foreground">
                    {favorite.cuisineId ? `${favorite.cuisineId} · ` : ""}
                    saved {relativeTime(favorite.createdAt)}
                    {favorite.sourceSessionId ? " · from a room" : ""}
                  </p>
                  {favorite.address ? (
                    <p className="mt-1 break-words font-body text-sm text-muted-foreground">
                      {favorite.address}
                    </p>
                  ) : null}
                  {/*
                    Rendered as a link only because both the CHECK constraint
                    in 0014 and safeWebUrl() in src/lib/favorites.ts have
                    already guaranteed an http(s) scheme. A `javascript:` URL
                    from a third-party places API landing in an href the app
                    writes is a stored-XSS shape, so the scheme is enforced at
                    the column, not here.
                  */}
                  {favorite.website ? (
                    <a
                      href={favorite.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-1 inline-flex items-center gap-1 font-body text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Website <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === favorite.id}
                    onClick={() => {
                      setEditingId(favorite.id);
                      setNoteDraft(favorite.notes ?? "");
                    }}
                  >
                    <Pencil /> Note
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === favorite.id}
                    onClick={() => handleRemove(favorite)}
                  >
                    {busyId === favorite.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Remove
                  </Button>
                </div>
              </div>

              {editingId === favorite.id ? (
                <div className="mt-3">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value.slice(0, NOTES_MAX_LENGTH))}
                    rows={2}
                    maxLength={NOTES_MAX_LENGTH}
                    aria-label={`Note about ${favorite.restaurantName}`}
                    placeholder="Book ahead on weekends…"
                    className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-body text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === favorite.id}
                      onClick={() => handleSaveNote(favorite)}
                    >
                      <Check /> Save note
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      <X /> Cancel
                    </Button>
                  </div>
                </div>
              ) : favorite.notes ? (
                <p className="mt-2 break-words font-body text-sm text-muted-foreground">
                  “{favorite.notes}”
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
