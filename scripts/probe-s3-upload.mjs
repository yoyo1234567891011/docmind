/**
 * Probe S3 avec .env.cloud-beta.local / .env.local
 * Usage: node scripts/probe-s3-upload.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const root = process.cwd();
Object.assign(
  process.env,
  loadEnv(path.join(root, ".env.local")),
  loadEnv(path.join(root, ".env.cloud-beta.local")),
);

const bucket = process.env.S3_BUCKET?.trim();
const endpoint = process.env.S3_ENDPOINT?.trim();
const region =
  process.env.S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "auto";
const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
const sessionToken = process.env.S3_SESSION_TOKEN?.trim();

console.log(
  JSON.stringify(
    {
      bucket: bucket || null,
      endpoint: endpoint || null,
      region,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "0",
      hasAccessKey: Boolean(accessKeyId),
      hasSecret: Boolean(secretAccessKey),
      hasSessionToken: Boolean(sessionToken),
      accessKeyPrefix: accessKeyId?.slice(0, 8) || null,
      DOCMIND_STORAGE: process.env.DOCMIND_STORAGE || null,
    },
    null,
    2,
  ),
);

if (!bucket || !accessKeyId || !secretAccessKey) {
  console.error("S3 env incomplete");
  process.exit(1);
}

const client = new S3Client({
  region,
  endpoint: endpoint || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "0",
  credentials: {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  },
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log("HEAD_BUCKET=OK");
} catch (e) {
  console.log(
    "HEAD_BUCKET_FAIL",
    e.name,
    e.Code || e.message,
    e.$metadata?.httpStatusCode,
  );
}

const key = `users/_ops-probe/probe-${Date.now()}.pdf`;
try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from("%PDF-1.4 probe\n"),
      ContentType: "application/pdf",
    }),
  );
  console.log("PUT_OK", key);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log("DELETE_OK");
} catch (e) {
  console.log(
    "PUT_FAIL",
    e.name,
    e.Code || e.message,
    e.$metadata?.httpStatusCode,
    String(e.message || "").slice(0, 300),
  );
  process.exit(1);
}
