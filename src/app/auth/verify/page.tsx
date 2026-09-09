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
      <p className="mt-3 text-sm text-[var(--muted)]">
        Si le lien ouvre <strong>127.0.0.1</strong> et que la page est
        inaccessible : utilisez le navigateur de <strong>cet ordinateur</strong>{" "}
        (là où tourne DocMind), pas le téléphone. Vérifiez aussi que{" "}
        <code className="text-xs">npm run dev</code> est lancé.
      </p>
    </AuthShell>
  );
}
