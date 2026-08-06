import { Suspense } from "react";

import { LoginForm } from "@/components/auth";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-sm">Chargement…</div>}>
      <LoginForm />
    </Suspense>
  );
}
