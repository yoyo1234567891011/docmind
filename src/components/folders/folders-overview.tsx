"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import { FolderIcon, PlusIcon } from "@/components/ui/icons";
import { createFolder, fetchFolders } from "@/lib/client";
import { UNFILED_FOLDER_ID, type FolderWithCount } from "@/types";

export function FoldersOverview() {
  const [folders, setFolders] = useState<FolderWithCount[]>([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchFolders();
      setFolders(data.folders);
      setUnfiledCount(data.unfiledCount);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les dossiers.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      await createFolder({ name, description });
      setName("");
      setDescription("");
      setShowCreate(false);
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Création du dossier impossible.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="animate-fade-up text-left">
          <h1 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Dossiers
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
            Classez vos documents dans des dossiers prédéfinis ou créez les
            vôtres.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setShowCreate((value) => !value)}
        >
          <PlusIcon className="h-4 w-4" />
          Nouveau dossier
        </Button>
      </div>

      {showCreate ? (
        <form
          onSubmit={(event) => {
            void handleCreate(event);
          }}
          className="surface-panel animate-fade-up space-y-3 rounded-2xl p-5 text-left"
        >
          <p className="font-display text-xl text-[var(--foreground)]">
            Créer un dossier
          </p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Nom
            </span>
            <input
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex. Véhicule, Famille…"
              className="h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Description
            </span>
            <input
              maxLength={160}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optionnel"
              className="h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={isCreating}>
              {isCreating ? "Création…" : "Créer"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreate(false)}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {isLoading ? (
        <HistoryListSkeleton />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Link
            href={`/dossiers/${UNFILED_FOLDER_ID}`}
            className="surface-panel animate-fade-up group rounded-2xl p-5 text-left transition-colors hover:border-[var(--accent)]"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <FolderIcon className="h-5 w-5" />
              </span>
              <span className="text-sm text-[var(--muted)]">
                {unfiledCount} doc{unfiledCount > 1 ? "s" : ""}
              </span>
            </div>
            <p className="mt-4 font-display text-2xl text-[var(--foreground)] group-hover:text-[var(--accent)]">
              Non classés
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Documents en attente de classement
            </p>
          </Link>

          {folders.map((folder, index) => (
            <Link
              key={folder.id}
              href={`/dossiers/${folder.id}`}
              className="surface-panel animate-fade-up group rounded-2xl p-5 text-left transition-colors hover:border-[var(--accent)]"
              style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                  <FolderIcon className="h-5 w-5" />
                </span>
                <div className="text-right">
                  <p className="text-sm text-[var(--muted)]">
                    {folder.documentCount} doc
                    {folder.documentCount > 1 ? "s" : ""}
                  </p>
                  {!folder.system ? (
                    <p className="text-[11px] text-[var(--accent)]">Perso</p>
                  ) : null}
                </div>
              </div>
              <p className="mt-4 font-display text-2xl text-[var(--foreground)] group-hover:text-[var(--accent)]">
                {folder.name}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">
                {folder.description}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
