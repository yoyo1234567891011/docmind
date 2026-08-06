import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) {
    redirect("/?auth=local");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/profil");
  }

  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "";

  return (
    <ProfileForm email={user.email ?? ""} fullName={fullName} />
  );
}
