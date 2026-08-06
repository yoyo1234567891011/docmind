import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { chaosGate } from "@/lib/chaos";
import { AppError } from "@/lib/errors";

type S3Global = typeof globalThis & {
  __docmindS3Client?: S3Client | null;
};

const g = globalThis as S3Global;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Configuration Object Storage incomplète (${name}).`,
      503,
    );
  }
  return value;
}

export function getS3Bucket(): string {
  return requireEnv("S3_BUCKET");
}

export function getS3Client(): S3Client {
  if (g.__docmindS3Client) return g.__docmindS3Client;
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region =
    process.env.S3_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "auto";

  g.__docmindS3Client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "0",
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
  });
  return g.__docmindS3Client;
}

export function pdfObjectKey(userId: string, documentId: string): string {
  return `users/${userId}/${documentId}.pdf`;
}

export async function putPdfObject(
  userId: string,
  documentId: string,
  bytes: Buffer,
): Promise<{ key: string }> {
  await chaosGate("s3_down");
  const key = pdfObjectKey(userId, documentId);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
    }),
  );
  return { key };
}

export async function getPdfObject(
  userId: string,
  documentId: string,
): Promise<Buffer> {
  await chaosGate("s3_down");
  const key = pdfObjectKey(userId, documentId);
  try {
    const out = await getS3Client().send(
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      }),
    );
    const stream = out.Body;
    if (!stream) {
      throw new AppError("NOT_FOUND", "PDF introuvable.", 404);
    }
    const bytes = await stream.transformToByteArray();
    return Buffer.from(bytes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const name = (error as { name?: string; Code?: string }).name;
    const code = (error as { Code?: string; $metadata?: { httpStatusCode?: number } })
      .Code;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (
      name === "NoSuchKey" ||
      name === "NotFound" ||
      code === "NoSuchKey" ||
      status === 404
    ) {
      throw new AppError("NOT_FOUND", "PDF introuvable sur le stockage.", 404);
    }
    throw new AppError(
      "INTERNAL_ERROR",
      "Impossible de lire le PDF depuis le stockage.",
      502,
    );
  }
}

export async function deletePdfObject(
  userId: string,
  documentId: string,
): Promise<void> {
  const key = pdfObjectKey(userId, documentId);
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
    }),
  );
}
