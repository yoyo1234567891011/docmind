import { AuthShell } from "@/components/auth";
import Link from "next/link";

export default function VerifyPage() {
  return (
    <AuthShell
      title="Confirmez votre e-mail"
      subtitle="Activez votre compte avant de vous connecter."
      footer={
        <Link href="/auth/login" className="text-[var(--accent)] hover:underline">
          Aller à la connexion
        </Link>
      }
    >
      <div
        role="status"
        className="rounded-xl border border-[color-mix(in_oklab,var(--warning)_45%,var(--border))] bg-[var(--warning-soft)] px-4 py-3 text-left text-sm leading-relaxed text-[var(--foreground)]"
      >
        <p>
          Un e-mail de confirmation vous a été envoyé. Ouvrez-le pour activer
          votre compte.
        </p>
        <p className="mt-2 font-medium">
          S’il n’arrive pas en 1–2 minutes, regardez vos spams / courrier
          indésirable (expéditeur : Échélia).
        </p>
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">
        Si le lien ouvre <strong>127.0.0.1</strong> et que la page est
        inaccessible : utilisez le navigateur de <strong>cet ordinateur</strong>{" "}
        (là où tourne l’app), pas le téléphone. Vérifiez aussi que{" "}
        <code className="text-xs">npm run dev</code> est lancé.
      </p>
    </AuthShell>
  );
}
