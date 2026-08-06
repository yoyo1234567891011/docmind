import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import { userTagsFile } from "@/config/paths";
import { AppError } from "@/lib/errors";
import {
  pgGetUserBlob,
  pgSaveUserBlob,
} from "@/services/persistence/user-blobs-pg";
import {
  TAG_COLORS,
  slugifyTagName,
  type CreateTagInput,
  type DocumentTag,
} from "@/types/tag";

interface TagsFileShape {
  tags: DocumentTag[];
}

const TAGS_BLOB_KEY = "tags";

async function ensureTagsFile(userId: string): Promise<string> {
  const filePath = userTagsFile(userId);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(
      filePath,
      JSON.stringify({ tags: [] } satisfies TagsFileShape, null, 2),
      "utf8",
    );
  }
  return filePath;
}

async function readTagsFile(userId: string): Promise<DocumentTag[]> {
  if (usePersistentStorage()) {
    const parsed = await pgGetUserBlob<TagsFileShape>(userId, TAGS_BLOB_KEY);
    return Array.isArray(parsed?.tags) ? parsed.tags : [];
  }
  const filePath = await ensureTagsFile(userId);
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as TagsFileShape;
    return Array.isArray(parsed.tags) ? parsed.tags : [];
  } catch {
    return [];
  }
}

async function writeTagsFile(
  userId: string,
  tags: DocumentTag[],
): Promise<void> {
  const payload = { tags } satisfies TagsFileShape;
  if (usePersistentStorage()) {
    await pgSaveUserBlob(userId, TAGS_BLOB_KEY, payload);
    return;
  }
  const filePath = await ensureTagsFile(userId);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function listTags(userId: string): Promise<DocumentTag[]> {
  const tags = await readTagsFile(userId);
  return tags.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function createTag(
  userId: string,
  input: CreateTagInput,
): Promise<DocumentTag> {
  const name = input.name?.trim();
  if (!name) {
    throw new AppError("BAD_REQUEST", "Le nom du tag est requis.");
  }
  if (name.length > 40) {
    throw new AppError("BAD_REQUEST", "Le tag ne peut pas dépasser 40 caractères.");
  }

  const slug = slugifyTagName(name);
  if (!slug) {
    throw new AppError("BAD_REQUEST", "Nom de tag invalide.");
  }

  const existing = await readTagsFile(userId);
  if (existing.some((tag) => tag.slug === slug)) {
    throw new AppError("BAD_REQUEST", "Ce tag existe déjà.", 400);
  }

  const color =
    input.color?.trim() ||
    TAG_COLORS[existing.length % TAG_COLORS.length] ||
    TAG_COLORS[0];

  const tag: DocumentTag = {
    id: `tag-${randomUUID()}`,
    name,
    slug,
    color,
    createdAt: new Date().toISOString(),
  };

  existing.push(tag);
  await writeTagsFile(userId, existing);
  return tag;
}

export async function deleteTag(
  userId: string,
  tagId: string,
): Promise<void> {
  const existing = await readTagsFile(userId);
  const next = existing.filter((tag) => tag.id !== tagId);
  if (next.length === existing.length) {
    throw new AppError("NOT_FOUND", "Tag introuvable.", 404);
  }
  await writeTagsFile(userId, next);
}

export async function assertTagIds(
  userId: string,
  tagIds: string[],
): Promise<string[]> {
  const existing = await listTags(userId);
  const allowed = new Set(existing.map((tag) => tag.id));
  const unique = [...new Set(tagIds.map((id) => id.trim()).filter(Boolean))];
  for (const id of unique) {
    if (!allowed.has(id)) {
      throw new AppError("BAD_REQUEST", `Tag introuvable: ${id}`, 400);
    }
  }
  return unique;
}
