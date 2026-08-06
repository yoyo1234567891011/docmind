import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { createTag, deleteTag, listTags } from "@/services/tags";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const tags = await listTags(user.id);
    return apiSuccess({ tags });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as { name?: string; color?: string };
    if (!body?.name?.trim()) {
      throw new AppError("BAD_REQUEST", "Le nom du tag est requis.");
    }
    const tag = await createTag(user.id, {
      name: body.name,
      color: body.color,
    });
    return apiSuccess(tag, 201);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id?.trim()) {
      throw new AppError("BAD_REQUEST", "Paramètre id requis.");
    }
    await deleteTag(user.id, id.trim());
    return apiSuccess({ deleted: true });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
