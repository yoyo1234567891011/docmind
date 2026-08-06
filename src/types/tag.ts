export interface DocumentTag {
  id: string;
  name: string;
  slug: string;
  color: string;
  createdAt: string;
}

export interface CreateTagInput {
  name: string;
  color?: string;
}

export const TAG_COLORS = [
  "#0f6e7a",
  "#b45309",
  "#b42318",
  "#0f7a4f",
  "#33445a",
  "#6d28d9",
] as const;

export function slugifyTagName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
