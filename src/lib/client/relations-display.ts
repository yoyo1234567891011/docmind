import { normalizeDisplayKey } from "@/ai/post-processing/display-cleanup";
import type { RelationListItem } from "@/lib/client/relations";

/** Normalise un nom de fichier pour comparer deux PDF. */
export function normalizeRelationFileName(name: string | undefined | null): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[^a-z0-9.]+/g, "")
    .trim();
}

/**
 * Identifiant de l’autre document (jamais le courant).
 * null = auto-relation ou données inutilisables.
 */
export function resolveRelationOtherId(
  item: Pick<RelationListItem, "fromDocId" | "toDocId" | "peer">,
  currentId: string,
): string | null {
  const from = item.fromDocId?.trim() || "";
  const to = item.toDocId?.trim() || "";
  const peer = item.peer?.documentId?.trim() || "";

  if (from && to && from === to) return null;
  if (from === currentId && to === currentId) return null;
  if (peer && peer === currentId && (!from || from === currentId) && (!to || to === currentId)) {
    return null;
  }

  if (from === currentId && to && to !== currentId) return to;
  if (to === currentId && from && from !== currentId) return from;

  if (peer && peer !== currentId) return peer;

  return null;
}

/**
 * Filtre d’affichage : ignore auto-liens (id ou même fichier) + dédup (type, otherId).
 */
export function filterRelationsForDisplay(
  items: RelationListItem[],
  currentId: string,
  currentFileName?: string | null,
): RelationListItem[] {
  const currentFile = normalizeRelationFileName(currentFileName);
  const seen = new Set<string>();
  const out: RelationListItem[] = [];

  for (const item of items) {
    const otherId = resolveRelationOtherId(item, currentId);
    if (!otherId || otherId === currentId) continue;

    const peerFile = normalizeRelationFileName(
      item.peer?.fileName || item.peer?.title,
    );
    if (currentFile && peerFile && currentFile === peerFile) continue;

    const key = `${item.type}::${otherId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

export function timelineEventDateKey(at: string): string {
  const raw = (at || "").trim();
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return iso;
}

/**
 * Dédup timeline : (kind, date, docId, libellé normalisé).
 * Renfort : échéances → 1 ligne / (date, docId) ; documents → 1 ligne / docId.
 */
export function dedupeTimelineEventsForDisplay<
  T extends {
    id: string;
    at: string;
    kind: string;
    label: string;
    documentId: string;
  },
>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const event of events) {
    const dateKey = timelineEventDateKey(event.at);
    const labelKey = normalizeDisplayKey(event.label || "");
    let key = `${event.kind}::${dateKey}::${event.documentId}::${labelKey}`;

    if (event.kind === "deadline") {
      // Garantit « 2027-12-24 = 1 ligne » même si le libellé varie légèrement.
      key = `deadline::${dateKey}::${event.documentId}`;
    } else if (event.kind === "document") {
      key = `document::${event.documentId}`;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }

  return out;
}
