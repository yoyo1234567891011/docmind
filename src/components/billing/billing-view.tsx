"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import { SpinnerIcon } from "@/components/ui/icons";
import {
  cancelSubscription,
  fetchBilling,
  fetchPlanChangePreview,
  openBillingPortal,
  resumeSubscription,
  startPlanCheckout,
  syncBilling,
  type BillingApiResponse,
} from "@/lib/client";
import {
  describePlanChangeMessage,
  describePlanChangePreview,
  describeUpcomingInvoice,
  PLAN_CHANGE_HINT,
} from "@/lib/billing/upcoming-display";
import { formatDateTime } from "@/lib/format";
import { formatClientNetworkError } from "@/lib/client/network-error";
import { cn } from "@/lib/utils";
import type { BillingPlanChangePreview, PaidBillingPlanId } from "@/types";

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

function isPaidPlanId(id: string): id is PaidBillingPlanId {
  return id === "basique" || id === "pro" || id === "premium" || id === "extra";
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
  const [planChangeConfirm, setPlanChangeConfirm] = useState<{
    targetPlan: PaidBillingPlanId;
    preview: BillingPlanChangePreview;
  } | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setIsLoading(true);
    setError(null);
    try {
      setData(await fetchBilling());
    } catch (loadError) {
      setError(
        formatClientNetworkError(loadError, "Impossible de charger la facturation."),
      );
    } finally {
      if (!options?.silent) setIsLoading(false);
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
          setInfo(
            `Plan ${next.plan.name} activé — droits synchronisés depuis Stripe.`,
          );
          return;
        }
        if (attempts < 6) scheduleRetry();
        else {
          setInfo(
            "Paiement reçu. Si le plan n’apparaît pas, cliquez sur Actualiser le statut.",
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
      await load({ silent: true });
    } catch (actionError) {
      setError(formatClientNetworkError(actionError, "Action impossible."));
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10">
        <HistoryListSkeleton />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10">
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
    upcomingInvoice,
    plans,
  } = data;

  const renewalLabel = subscription.cancelAtPeriodEnd
    ? "Fin d’accès"
    : "Prochain renouvellement";

  const showUpcomingBilling =
    isPremium && stripeConfigured && !entitlementsDevBypass;
  const upcomingView = showUpcomingBilling
    ? describeUpcomingInvoice(upcomingInvoice, plan, subscription)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-5 py-10 sm:px-6">
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
          Plan synchronisé avec Stripe. Un changement de plan payant facture
          immédiatement le prix mensuel complet du nouveau plan choisi.
        </p>
      </header>

      {subscription.status === "past_due" ? (
        <Alert tone="info" title="Paiement en retard">
          Votre dernier prélèvement a échoué.
          {upcomingInvoice.status === "open" && upcomingInvoice.amountDue != null
            ? ` Montant dû : ${upcomingInvoice.amountDue.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €.`
            : null}{" "}
          Mettez à jour votre moyen de paiement via le portail Stripe pour éviter
          la suspension de l’abonnement.
        </Alert>
      ) : null}
      {subscription.status === "unpaid" ? (
        <Alert tone="error" title="Abonnement impayé">
          L’accès payant a été révoqué. Régularisez votre paiement dans le
          portail Stripe pour réactiver votre plan.
        </Alert>
      ) : null}

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
          Ajoutez STRIPE_SECRET_KEY, STRIPE_PRICE_BASIQUE / PRO / PREMIUM /
          EXTRA et STRIPE_WEBHOOK_SECRET. En local sans Stripe, l’offre Pro
          reste ouverte pour le développement.
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

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-[var(--muted)]">Plan</p>
            <p className="font-display text-3xl">{plan.name}</p>
            {plan.priceMonthlyEur != null ? (
              <p className="mt-1 text-sm text-[var(--muted)]">
                {plan.priceMonthlyEur.toLocaleString("fr-FR", {
                  minimumFractionDigits: 2,
                })}{" "}
                € / mois (facturé par Stripe)
              </p>
            ) : null}
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
                    ? `Plan ${next.plan.name} synchronisé depuis Stripe.`
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
                void run("checkout-pro", async () => {
                  const result = await startPlanCheckout("pro");
                  if ("url" in result && result.url) {
                    window.location.href = result.url;
                  }
                })
              }
            >
              {busy === "checkout-pro" ? (
                <SpinnerIcon className="h-4 w-4" />
              ) : null}
              Passer à Pro
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
                Changer de plan / factures
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
                        "Annuler le renouvellement ? Vous gardez l’accès jusqu’à la fin de la période déjà payée.",
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
                          ? `Renouvellement annulé — accès jusqu’au ${formatDateTime(result.currentPeriodEnd)}.`
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

      {showUpcomingBilling && upcomingView ? (
        <section
          className={cn(
            "rounded-xl border p-6",
            upcomingInvoice.status === "open"
              ? "border-[var(--warning)] bg-[var(--warning-soft)]"
              : "border-[var(--border)] bg-[var(--surface)]",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                {upcomingView.title}
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--foreground)]">
                {upcomingView.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            {upcomingView.showPortalHint ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("portal-upcoming", async () => {
                    const { url } = await openBillingPortal();
                    window.location.href = url;
                  })
                }
              >
                Voir le détail sur Stripe
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {planChangeConfirm ? (
        <section className="rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            Confirmer le changement de plan
          </p>
          <p className="mt-2 font-display text-2xl">
            {planChangeConfirm.preview.currentPlanName} →{" "}
            {planChangeConfirm.preview.targetPlanName}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-[var(--foreground)]">
            {describePlanChangePreview(planChangeConfirm.preview).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              disabled={Boolean(busy)}
              onClick={() => {
                const targetPlan = planChangeConfirm.targetPlan;
                void run(`confirm-${targetPlan}`, async () => {
                  const result = await startPlanCheckout(targetPlan);
                  setPlanChangeConfirm(null);
                  if ("url" in result && result.url) {
                    window.location.href = result.url;
                    return;
                  }
                  if (result.changed) {
                    const refreshed = await fetchBilling();
                    setData(refreshed);
                    const planName =
                      plans.find((p) => p.id === result.plan)?.name ??
                      result.plan;
                    const targetMonthly =
                      plans.find((p) => p.id === result.plan)
                        ?.priceMonthlyEur ?? null;
                    setInfo(
                      describePlanChangeMessage({
                        planName,
                        targetMonthlyEur: targetMonthly,
                        immediateInvoice: result.immediateInvoice,
                        upcoming: refreshed.upcomingInvoice,
                        subscription: refreshed.subscription,
                      }),
                    );
                  }
                });
              }}
            >
              {busy?.startsWith("confirm-") ? (
                <SpinnerIcon className="h-4 w-4" />
              ) : null}
              Confirmer et payer
              {planChangeConfirm.preview.immediateAmountDue != null
                ? ` ${planChangeConfirm.preview.immediateAmountDue.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`
                : ""}
            </Button>
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => setPlanChangeConfirm(null)}
            >
              Annuler
            </Button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {plans.map((item) => {
          const active = item.id === plan.id;
          const highlighted = Boolean(item.highlighted);
          const canCheckout =
            isPaidPlanId(item.id) &&
            !active &&
            stripeConfigured &&
            !entitlementsDevBypass &&
            (!isPremium || item.id !== plan.id);

          return (
            <article
              key={item.id}
              className={cn(
                "flex flex-col rounded-xl border p-5 text-left",
                active || highlighted
                  ? "border-[var(--accent)] bg-[var(--surface)]"
                  : "border-[var(--border)] bg-[var(--surface)]",
              )}
            >
              <p className="text-sm font-medium text-[var(--muted)]">
                {item.name}
                {active ? " · actuel" : ""}
                {highlighted && !active ? " · recommandé" : ""}
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
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-[var(--foreground)]">
                {item.features.map((feature) => (
                  <li key={feature}>— {feature}</li>
                ))}
              </ul>
              {canCheckout && isPremium ? (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {PLAN_CHANGE_HINT}
                </p>
              ) : null}
              {canCheckout ? (
                <Button
                  className="mt-5 w-full"
                  variant={highlighted ? "primary" : "secondary"}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    const checkoutPlan = item.id;
                    if (!isPaidPlanId(checkoutPlan)) return;
                    if (isPremium) {
                      void (async () => {
                        setBusy(`preview-${checkoutPlan}`);
                        setError(null);
                        try {
                          const preview = await fetchPlanChangePreview(
                            checkoutPlan,
                          );
                          setPlanChangeConfirm({
                            targetPlan: checkoutPlan,
                            preview,
                          });
                        } catch (previewError) {
                          setError(
                            previewError instanceof Error
                              ? previewError.message
                              : "Impossible de prévisualiser le changement.",
                          );
                        } finally {
                          setBusy(null);
                        }
                      })();
                      return;
                    }
                    void run(`checkout-${checkoutPlan}`, async () => {
                      const result = await startPlanCheckout(checkoutPlan);
                      if ("url" in result && result.url) {
                        window.location.href = result.url;
                      }
                    });
                  }}
                >
                  {busy === `checkout-${item.id}` ? (
                    <SpinnerIcon className="h-4 w-4" />
                  ) : null}
                  {isPremium ? `Passer à ${item.name}` : `Choisir ${item.name}`}
                </Button>
              ) : null}
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
