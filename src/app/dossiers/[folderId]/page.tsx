import { redirect } from "next/navigation";

interface FolderDetailPageProps {
  params: Promise<{ folderId: string }>;
}

export default async function FolderDetailRedirectPage({
  params,
}: FolderDetailPageProps) {
  const { folderId } = await params;
  redirect(`/documents?folder=${encodeURIComponent(folderId)}`);
}
