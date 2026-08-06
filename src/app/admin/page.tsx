import { redirect } from "next/navigation";

import { AdminPanel } from "@/components/admin/admin-panel";
import { requireAdmin } from "@/lib/auth";

export default async function AdminPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/dashboard");
  }

  return (
    <section className="mx-auto max-w-7xl px-5 py-10 sm:px-6">
      <AdminPanel />
    </section>
  );
}
