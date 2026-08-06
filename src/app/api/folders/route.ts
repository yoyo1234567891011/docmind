import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { createFolder, listFoldersWithCounts } from "@/services/folders";

export const runtime = "nodejs";

/**
 * GET /api/folders
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const data = await listFoldersWithCounts(user.id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * POST /api/folders
 * Body: { name: string, description?: string }
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as {
      name?: string;
      description?: string;
    };

    if (!body?.name?.trim()) {
      throw new AppError("BAD_REQUEST", "Le nom du dossier est requis.");
    }

    const folder = await createFolder(user.id, {
      name: body.name,
      description: body.description,
    });

    return apiSuccess(folder, 201);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
