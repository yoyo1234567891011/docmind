import { NextResponse } from "next/server";

import { docmindConfig } from "@/config/docmind";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { trackAnalyticsEvent } from "@/services/analytics";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(
    searchParams.get("next"),
    docmindConfig.auth.afterLoginPath,
  );

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Lien email / OAuth — pas de PII (email)
      await trackAnalyticsEvent({
        name: "auth.login",
        userId: user?.id ?? null,
        meta: {
          provider: "email_link",
          source: "auth_callback",
        },
      });
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback`);
}
