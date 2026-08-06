"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import { SpinnerIcon } from "@/components/ui/icons";
import {
  cancelSubscription,
  fetchBilling,
  openBillingPortal,
  resumeSubscription,
  startPremiumCheckout,
  syncBilling,
  type BillingApiResponse,
} from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function badgeClass(tone: string): string {
  switch (tone) {
    case "success":
      return "bg-[var(--accent-soft)] text-[var(--accent)]";
    case "info":
      return "bg-[var(--surface-elevated)] text-[var(--foreground)]";
    case "warning":
      return "bg-[var(--warning-soft)] text-[var(--warning)]";
    case "danger":
      return "bg-[var(--danger-soft)] text-[var(--danger)]";
    default:
      return "bg-[var(--surface-elevated)] text-[var(--muted)]";
  }
}

export function BillingView() {
  const searchParams = useSearchParams();
  const checkoutState = searchParams.get("checkout");
  const checkoutSessionId = searchParams.get("session_id");

  const [data, setData] = useState<BillingApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    checkoutState === "success"
      ? "Paiement reçu. Synchronisation Stripe en cours…"
      : checkoutState === "cancel"
        ? "Checkout annulé — aucun prélèvement."
        : null,
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchBilling());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger la facturation.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Après checkout : sync directe Stripe (ne dépend pas du webhook local). */
  useEffect(() => {
    if (checkoutState !== "success") return;
    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = () => {
      retryTimer = setTimeout(() => {
        void runSync();
      }, 1500);
    };

    const runSync = async () => {
      attempts += 1;
      try {
        const next = await syncBilling({ sessionId: checkoutSessionId });
        if (cancelled) return;
        setData(next);
        if (next.isPremium) {
          setInfo("Premium activé — droits synchronisés depuis Stripe.");
          return;
        }
        if (attempts < 6) scheduleRetry();
        else {
          setInfo(
            "Paiement reçu. Si Premium n’apparaît pas, cliquez sur Actualiser le statut.",
          );
        }
      } catch {
        if (cancelled) return;
        if (attempts < 6) scheduleRetry();
        else {
          setInfo(
            "Synchronisation Stripe temporairement impossible. Cliquez sur Actualiser le statut — votre paiement n’est pas perdu.",
          );
        }
      }
    };

    void runSync();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [checkoutState, checkoutSessionId]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Action impossible.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10">
        <HistoryListSkeleton />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10">
        <Alert tone="error" title="Facturation">
          {error || "Données indisponibles."}
        </Alert>
      </div>
    );
  }

  const {
    subscription,
    plan,
    isPremium,
    accessBadge,
    stripeConfigured,
    entitlementsDevBypass,
    invoices,
    plans,
  } = data;

  const renewalLabel = subscription.cancelAtPeriodEnd
    ? "Fin d’accès"
    : "Prochain renouvellement";

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-5 py-10 sm:px-6">
      <header className="text-left">
        <p className="text-sm text-[var(--muted)]">
          <Link href="/dashboard" className="hover:text-[var(--accent)]">
            ← Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">
          Facturation
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Statut d’abonnement synchronisé via les webhooks Stripe (pas uniquement
          le navigateur).
        </p>
      </header>

      {info ? (
        <Alert tone="success" title="Information">
          {info}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}
      {!stripeConfigured ? (
        <Alert tone="info" title="Stripe non configuré">
          Ajoutez STRIPE_SECRET_KEY, STRIPE_PRICE_PREMIUM et
          STRIPE_WEBHOOK_SECRET dans .env.local. En local sans Stripe, Premium
          reste disponible pour le développement.
        </Alert>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            Abonnement
          </p>
          <span
            className={cn(
              "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
              badgeClass(accessBadge.tone),
            )}
          >
            {accessBadge.label}
          </span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-[var(--muted)]">Plan</p>
            <p className="font-display text-3xl">{plan.name}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {accessBadge.description}
            </p>
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-[var(--muted)]">Statut Stripe · </span>
              <code className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 text-xs">
                {subscription.status}
              </code>
            </p>
            {subscription.currentPeriodEnd ? (
              <p>
                <span className="text-[var(--muted)]">{renewalLabel} · </span>
                {formatDateTime(subscription.currentPeriodEnd)}
              </p>
            ) : (
              <p className="text-[var(--muted)]">Aucune date de période</p>
            )}
            {subscription.canceledAt ? (
              <p>
                <span className="text-[var(--muted)]">
                  Annulation demandée ·{" "}
                </span>
                {formatDateTime(subscription.canceledAt)}
              </p>
            ) : null}
            {subscription.cancelAtPeriodEnd ? (
              <p className="text-[var(--warning)]">
                Annulation programmée en fin de période
              </p>
            ) : null}
          </div>
        </div>

        <dl className="mt-6 grid gap-3 border-t border-[var(--border)] pt-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Customer Stripe</dt>
            <dd className="mt-0.5 break-all font-mono">
              {subscription.stripeCustomerId || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Subscription Stripe</dt>
            <dd className="mt-0.5 break-all font-mono">
              {subscription.stripeSubscriptionId || "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">Dernier webhook</dt>
            <dd className="mt-0.5">
              {subscription.lastWebhookEventType ? (
                <>
                  <code className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5">
                    {subscription.lastWebhookEventType}
                  </code>
                  {subscription.lastWebhookAt
                    ? ` · ${formatDateTime(subscription.lastWebhookAt)}`
                    : ""}
                  {subscription.lastWebhookEventId ? (
                    <span className="mt-1 block break-all font-mono text-[var(--muted)]">
                      {subscription.lastWebhookEventId}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-[var(--muted)]">Aucun événement reçu</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("refresh", async () => {
                const next = await syncBilling({
                  sessionId: checkoutSessionId,
                });
                setData(next);
                setInfo(
                  next.isPremium
                    ? "Premium synchronisé depuis Stripe."
                    : next.synced
                      ? "Statut Stripe mis à jour."
                      : "Aucun abonnement Stripe trouvé pour ce compte.",
                );
              })
            }
          >
            {busy === "refresh" ? <SpinnerIcon className="h-4 w-4" /> : null}
            Actualiser le statut
          </Button>
          {!isPremium && !entitlementsDevBypass ? (
            <Button
              disabled={Boolean(busy) || !stripeConfigured}
              onClick={() =>
                void run("checkout", async () => {
                  const { url } = await startPremiumCheckout();
                  window.location.href = url;
                })
              }
            >
              {busy === "checkout" ? (
                <SpinnerIcon className="h-4 w-4" />
              ) : null}
              Passer à Premium
            </Button>
          ) : null}
          {isPremium && stripeConfigured && !entitlementsDevBypass ? (
            <>
              <Button
                variant="secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("portal", async () => {
                    const { url } = await openBillingPortal();
                    window.location.href = url;
                  })
                }
              >
                Gérer / factures
              </Button>
              {subscription.cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("resume", async () => {
                      await resumeSubscription();
                      const next = await syncBilling();
                      setData(next);
                      setInfo("Annulation annulée — abonnement repris.");
                    })
                  }
                >
                  Reprendre
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Annuler le renouvellement Premium ? Vous gardez l’accès jusqu’à la fin de la période déjà payée.",
                      )
                    ) {
                      return;
                    }
                    void run("cancel", async () => {
                      const result = await cancelSubscription();
                      const next = await syncBilling();
                      setData(next);
                      setInfo(
                        result.currentPeriodEnd
                          ? `Renouvellement annulé — accès Premium jusqu’au ${formatDateTime(result.currentPeriodEnd)} (badge « Expire bientôt »).`
                          : "Renouvellement annulé en fin de période.",
                      );
                    });
                  }}
                >
                  Annuler le renouvellement
                </Button>
              )}
            </>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {plans.map((item) => {
          const active = item.id === plan.id;
          return (
            <article
              key={item.id}
              className={cn(
                "rounded-xl border p-5 text-left",
                active
                  ? "border-[var(--accent)] bg-[var(--surface)]"
                  : "border-[var(--border)] bg-[var(--surface)]",
              )}
            >
              <p className="text-sm font-medium text-[var(--muted)]">
                {item.name}
                {active ? " · actuel" : ""}
              </p>
              <p className="mt-2 font-display text-3xl">
                {item.priceMonthlyEur == null
                  ? "Gratuit"
                  : `${item.priceMonthlyEur} €`}
                {item.priceMonthlyEur != null ? (
                  <span className="ml-1 text-sm font-sans text-[var(--muted)]">
                    / mois
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {item.description}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-[var(--foreground)]">
                {item.features.map((feature) => (
                  <li key={feature}>— {feature}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl">Factures</h2>
          {isPremium && stripeConfigured ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("portal2", async () => {
                  const { url } = await openBillingPortal();
                  window.location.href = url;
                })
              }
            >
              Portail Stripe
            </Button>
          ) : null}
        </div>

        {invoices.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Aucune facture pour le moment.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[var(--foreground)]">
                    {invoice.number || invoice.id}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {formatDateTime(invoice.createdAt)} ·{" "}
                    {invoice.status || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span>
                    {invoice.amountPaid.toLocaleString("fr-FR", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    {invoice.currency}
                  </span>
                  {invoice.hostedInvoiceUrl ? (
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] hover:underline"
                    >
                      Voir
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
