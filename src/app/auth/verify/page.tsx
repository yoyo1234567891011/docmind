import { AuthShell } from "@/components/auth";
import Link from "next/link";

export default function VerifyPage() {
  return (
    <AuthShell
      title="Vérification email"
      subtitle="Confirmez votre adresse pour activer le compte."
      footer={
        <Link href="/auth/login" className="text-[var(--accent)] hover:underline">
          Aller à la connexion
        </Link>
      }
    >
      <p className="text-sm text-[var(--muted)]">
        Cliquez sur le lien reçu par email. Une fois confirmé, vous pourrez vous
        connecter à DocMind.
      </p>
    </AuthShell>
  );
}
