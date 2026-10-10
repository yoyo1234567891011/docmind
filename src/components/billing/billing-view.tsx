"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import { CheckIcon, SpinnerIcon } from "@/components/ui/icons";
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
import { getVisibleBillingPlanIds } from "@/config/billing";
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
      return "ui-badge border-[color-mix(in_oklab,var(--accent)_22%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]";
    case "info":
      return "ui-badge border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[var(--surface-elevated)] text-[var(--foreground)]";
    case "warning":
      return "ui-badge border-[color-mix(in_oklab,var(--warning)_22%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]";
    case "danger":
      return "ui-badge border-[color-mix(in_oklab,var(--danger)_22%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]";
    default:
      return "ui-badge bg-[var(--surface-elevated)] text-[var(--muted)]";
  }
}

function isPaidPlanId(id: string): id is PaidBillingPlanId {
  return id === "basique" || id === "pro" || id === "premium" || id === "extra";
}

const PLAN_CHANGE_PENDING_KEY = "docmind_plan_change_pending";

function isPaymentBusy(busy: string | null): boolean {
  if (!busy) return false;
  return (
    busy.startsWith("confirm-") ||
    busy.startsWith("checkout-") ||
    busy === "plan-change-sync"
  );
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
        ? "Checkout annulé — votre plan n’a pas changé."
        : null,
  );
  const [infoTone, setInfoTone] = useState<"success" | "info">(
    checkoutState === "success" || checkoutState === "cancel" ? "info" : "success",
  );
  const [planChangeConfirm, setPlanChangeConfirm] = useState<{
    targetPlan: PaidBillingPlanId;
    preview: BillingPlanChangePreview;
  } | null>(null);
  /** Case CGV + renonciation 14j — obligatoire avant nouveau Checkout (Free → payant). */
  const [acceptedImmediateExecution, setAcceptedImmediateExecution] =
    useState(false);

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

  /**
   * Sync après Checkout (`?checkout=success`) ou retour 3DS
   * (sessionStorage posé avant redirect facture hébergée).
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let pendingPlan: string | null = null;
    try {
      pendingPlan = sessionStorage.getItem(PLAN_CHANGE_PENDING_KEY);
    } catch {
      pendingPlan = null;
    }

    if (checkoutState !== "success" && !pendingPlan) return;

    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const clearPending = () => {
      try {
        sessionStorage.removeItem(PLAN_CHANGE_PENDING_KEY);
      } catch {
        // ignore
      }
    };

    const scheduleRetry = () => {
      retryTimer = setTimeout(() => {
        void runSync();
      }, 1500);
    };

    const runSync = async () => {
      attempts += 1;
      setBusy((prev) => prev ?? "plan-change-sync");
      setInfoTone("info");
      setInfo(
        "Synchronisation Stripe en cours… le nouveau plan s’affiche après confirmation du paiement.",
      );
      try {
        const next = await syncBilling({ sessionId: checkoutSessionId });
        if (cancelled) return;
        setData(next);

        const matchedPending =
          pendingPlan != null && next.plan.id === pendingPlan;
        if (matchedPending || (checkoutState === "success" && next.isPremium)) {
          clearPending();
          setInfoTone("success");
          setInfo(`Passage à ${next.plan.name} confirmé.`);
          setBusy(null);
          return;
        }

        if (pendingPlan && next.plan.id !== pendingPlan && attempts >= 6) {
          setInfoTone("info");
          setInfo(
            "Le paiement n’est pas encore confirmé (3DS annulé ou en attente). Votre plan actuel reste affiché — actualisez après validation.",
          );
          setBusy(null);
          return;
        }

        if (attempts < 6) {
          scheduleRetry();
          return;
        }

        clearPending();
        setInfoTone("info");
        setInfo(
          "Paiement reçu. Si le plan n’apparaît pas, cliquez sur Actualiser le statut.",
        );
        setBusy(null);
      } catch {
        if (cancelled) return;
        if (attempts < 6) {
          scheduleRetry();
          return;
        }
        setInfoTone("info");
        setInfo(
          "Synchronisation Stripe temporairement impossible. Cliquez sur Actualiser le statut — votre paiement n’est pas perdu.",
        );
        setBusy(null);
      }
    };

    void runSync();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [checkoutState, checkoutSessionId]);

  const run = async (
    key: string,
    action: () => Promise<void>,
    options?: { skipReload?: boolean },
  ) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      if (!options?.skipReload) {
        await load({ silent: true });
      }
    } catch (actionError) {
      setInfo(null);
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
    stripeTestMode,
  } = data;

  const renewalLabel = subscription.cancelAtPeriodEnd
    ? "Fin d’accès"
    : "Prochain prélèvement";

  const showUpcomingBilling =
    stripeConfigured &&
    !entitlementsDevBypass &&
    (isPremium ||
      subscription.status === "past_due" ||
      Boolean(subscription.hasStripeSubscription));
  const upcomingView = showUpcomingBilling
    ? describeUpcomingInvoice(upcomingInvoice, plan, subscription)
    : null;

  const visiblePlanIds = new Set(getVisibleBillingPlanIds(plan.id));
  const catalogPlans = plans.filter((item) => visiblePlanIds.has(item.id));

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-5 py-10 sm:px-6">
      <header className="text-left">
        <p className="text-sm text-[var(--muted)]">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-[var(--radius-sm)] text-[13px] transition-colors hover:text-[var(--foreground)]"
          >
            ← Dashboard
          </Link>
        </p>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.025em] sm:text-[3rem]">
          Facturation
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-[15px]">
          Plan synchronisé avec Stripe. Un changement de plan payant ajuste le
          montant au prorata de la période restante (calcul Stripe).
        </p>
      </header>

      {subscription.pendingPlan && subscription.pendingPlanEffectiveAt ? (
        <Alert tone="info" title="Changement programmé">
          Passage à{" "}
          {plans.find((p) => p.id === subscription.pendingPlan)?.name ??
            subscription.pendingPlan}{" "}
          le {formatDateTime(subscription.pendingPlanEffectiveAt)}. Jusqu’à
          cette date vous restez sur {plan.name}.
        </Alert>
      ) : null}

      {subscription.status === "past_due" ? (
        <Alert tone="info" title="Paiement en retard">
          Votre dernier prélèvement a échoué — les quotas payants sont suspendus
          (offre Gratuite) jusqu’à régularisation.
          {upcomingInvoice.status === "open" && upcomingInvoice.amountDue != null
            ? ` Montant dû : ${upcomingInvoice.amountDue.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €.`
            : null}{" "}
          Mettez à jour votre moyen de paiement via le portail Stripe ; l’accès
          payant revient dès que le paiement réussit.
        </Alert>
      ) : null}
      {subscription.status === "unpaid" ? (
        <Alert tone="error" title="Abonnement impayé">
          L’accès payant a été révoqué. Régularisez votre paiement dans le
          portail Stripe pour réactiver votre plan.
        </Alert>
      ) : null}

      {isPaymentBusy(busy) ? (
        <Alert tone="info" title="Paiement en cours">
          <span className="inline-flex items-center gap-2">
            <SpinnerIcon className="h-4 w-4" />
            Communication avec Stripe… ne fermez pas cette page. Le nouveau plan
            ne s’affiche qu’après confirmation du paiement.
          </span>
        </Alert>
      ) : null}
      {info ? (
        <Alert
          tone={infoTone === "info" ? "info" : "success"}
          title={
            infoTone === "success" ? "Passage confirmé" : "Information"
          }
        >
          {info}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" title="Échec — plan inchangé">
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
      {stripeConfigured && stripeTestMode ? (
        <Alert tone="info" title="Mode test — aucun débit réel">
          Stripe est en mode TEST (clés sk_test). Aucun prélèvement réel n’est
          effectué. Utilisez les cartes de test Stripe (ex. 4242…), pas une
          vraie carte.
        </Alert>
      ) : null}

      <section className="ui-card rounded-[var(--radius-xl)] p-6 sm:p-7">
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
                    ? `Passage à ${next.plan.name} confirmé.`
                    : next.synced
                      ? "Statut Stripe mis à jour."
                      : "Aucun abonnement Stripe trouvé pour ce compte.",
                );
                setInfoTone(next.isPremium ? "success" : "info");
              })
            }
          >
            {busy === "refresh" ? <SpinnerIcon className="h-4 w-4" /> : null}
            Actualiser le statut
          </Button>
          {!isPremium && !entitlementsDevBypass ? (
            <Button
              disabled={
                Boolean(busy) ||
                !stripeConfigured ||
                !acceptedImmediateExecution
              }
              onClick={() =>
                void run("checkout-pro", async () => {
                  const result = await startPlanCheckout("pro", {
                    acceptedImmediateExecution: true,
                  });
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
            "rounded-[var(--radius-xl)] border p-6 shadow-[var(--shadow-sm)] sm:p-7",
            upcomingView.tone === "warning" || upcomingInvoice.status === "open"
              ? "border-[var(--warning)] bg-[var(--warning-soft)]"
              : "border-[color-mix(in_oklab,var(--border)_88%,transparent)] bg-[var(--surface)]",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                {upcomingView.title}
              </p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {upcomingView.rows.map((row) => (
                  <div key={`${row.label}:${row.value}`}>
                    <dt className="text-xs text-[var(--muted)]">{row.label}</dt>
                    <dd className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {upcomingView.footnotes.length > 0 ? (
                <ul className="mt-4 space-y-1 text-xs text-[var(--muted)]">
                  {upcomingView.footnotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {upcomingView.showPortalHint ||
            upcomingInvoice.openInvoice?.hostedInvoiceUrl ? (
              <div className="flex flex-col gap-2">
                {upcomingInvoice.openInvoice?.hostedInvoiceUrl ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const url = upcomingInvoice.openInvoice?.hostedInvoiceUrl;
                      if (url) window.open(url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    Payer la facture ouverte
                  </Button>
                ) : null}
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
            ) : null}
          </div>
        </section>
      ) : null}

      {planChangeConfirm ? (
        <section className="ui-card-elevated rounded-[var(--radius-xl)] border border-[var(--accent)] p-6 ring-1 ring-[color-mix(in_oklab,var(--accent)_18%,transparent)] sm:p-7">
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
          {busy?.startsWith("confirm-") ? (
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--accent)]">
              <SpinnerIcon className="h-4 w-4" />
              Ouverture de la page Stripe (carte / 3DS)…
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              disabled={Boolean(busy)}
              onClick={() => {
                const targetPlan = planChangeConfirm.targetPlan;
                const targetName = planChangeConfirm.preview.targetPlanName;
                void run(
                  `confirm-${targetPlan}`,
                  async () => {
                    setInfoTone("info");
                    setInfo(
                      `Redirection vers Stripe pour confirmer le passage à ${targetName} (carte / 3DS)…`,
                    );
                    const result = await startPlanCheckout(targetPlan);
                    if ("url" in result && result.url) {
                      try {
                        sessionStorage.setItem(
                          PLAN_CHANGE_PENDING_KEY,
                          targetPlan,
                        );
                      } catch {
                        // ignore
                      }
                      setInfoTone("info");
                      setInfo(
                        "Confirmation sur Stripe… Le nouveau plan ne s’active qu’après paiement réussi. Si vous abandonnez la page Stripe, votre plan actuel reste inchangé.",
                      );
                      window.location.href = result.url;
                      return;
                    }
                    if ("scheduled" in result && result.scheduled) {
                      const refreshed = await syncBilling();
                      setData(refreshed);
                      setPlanChangeConfirm(null);
                      const pendingName =
                        refreshed.plans.find((p) => p.id === result.pendingPlan)
                          ?.name ?? result.pendingPlan;
                      const currentName =
                        refreshed.plans.find((p) => p.id === result.currentPlan)
                          ?.name ?? result.currentPlan;
                      setInfoTone("success");
                      setInfo(
                        `Passage à ${pendingName} le ${formatDateTime(result.effectiveAt)}. Jusqu’à cette date vous restez sur ${currentName}.`,
                      );
                      return;
                    }
                    if ("changed" in result && result.changed) {
                      const refreshed = await syncBilling();
                      setData(refreshed);
                      setPlanChangeConfirm(null);
                      const planName =
                        refreshed.plans.find((p) => p.id === result.plan)
                          ?.name ??
                        plans.find((p) => p.id === result.plan)?.name ??
                        result.plan;
                      const targetMonthly =
                        refreshed.plans.find((p) => p.id === result.plan)
                          ?.priceMonthlyEur ??
                        plans.find((p) => p.id === result.plan)
                          ?.priceMonthlyEur ??
                        null;
                      setInfoTone("success");
                      setInfo(
                        describePlanChangeMessage({
                          planName,
                          targetMonthlyEur: targetMonthly,
                          immediateInvoice: result.immediateInvoice,
                          upcoming: refreshed.upcomingInvoice,
                          subscription: refreshed.subscription,
                        }),
                      );
                    } else {
                      throw new Error(
                        "Stripe n’a pas renvoyé de page de confirmation. Réessayez.",
                      );
                    }
                  },
                  { skipReload: true },
                );
              }}
            >
              {busy?.startsWith("confirm-") ? (
                <SpinnerIcon className="h-4 w-4" />
              ) : null}
              {busy?.startsWith("confirm-")
                ? planChangeConfirm.preview.deferredToPeriodEnd
                  ? "Programmation…"
                  : "Redirection Stripe…"
                : planChangeConfirm.preview.deferredToPeriodEnd
                  ? `Confirmer le passage au ${
                      planChangeConfirm.preview.nextBillingDate
                        ? formatDateTime(
                            planChangeConfirm.preview.nextBillingDate,
                          )
                        : "fin de période"
                    }`
                  : `Confirmer sur Stripe${
                      planChangeConfirm.preview.immediateAmountDue != null
                        ? ` · ${planChangeConfirm.preview.immediateAmountDue.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`
                        : ""
                    }`}
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

      {!isPremium && stripeConfigured && !entitlementsDevBypass ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--border)_88%,transparent)] bg-[var(--surface)] p-4 text-left text-sm leading-relaxed text-[var(--foreground)] shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] hover:border-[var(--border-strong)]">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
            checked={acceptedImmediateExecution}
            onChange={(e) => setAcceptedImmediateExecution(e.target.checked)}
          />
          <span>
            J’accepte les{" "}
            <Link
              href="/cgv"
              className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
            >
              CGV
            </Link>{" "}
            et je demande l’exécution immédiate du service. Je reconnais
            renoncer au délai de rétractation de 14 jours pour la période déjà
            consommée, conformément au Code de la consommation.
          </span>
        </label>
      ) : null}

      <section
        className={cn(
          "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
          catalogPlans.length > 3 ? "xl:grid-cols-4" : null,
        )}
      >
        {catalogPlans.map((item) => {
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
                "relative flex flex-col rounded-[var(--radius-xl)] border p-5 text-left transition-[border-color,box-shadow,transform] duration-200 sm:p-6",
                active || highlighted
                  ? "border-[color-mix(in_oklab,var(--accent)_55%,var(--border))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent)_6%,var(--surface)),var(--surface)_45%)] shadow-[var(--highlight),0_0_0_1px_color-mix(in_oklab,var(--accent)_18%,transparent),var(--shadow-md)]"
                  : "border-[var(--hairline)] bg-[var(--surface)] shadow-[var(--highlight),var(--shadow-sm)] hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--highlight),var(--shadow-md)]",
              )}
            >
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                {item.name}
                {active ? (
                  <span className="ui-badge bg-[var(--accent)] text-[var(--accent-foreground)]">
                    actuel
                  </span>
                ) : null}
                {highlighted && !active ? (
                  <span className="ui-badge bg-[var(--accent-soft)] text-[var(--accent)]">
                    recommandé
                  </span>
                ) : null}
              </p>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-1 font-display text-[2.25rem] leading-none tracking-tight">
                {item.priceMonthlyEur == null
                  ? "Gratuit"
                  : `${item.priceMonthlyEur} €`}
                {item.priceMonthlyEur != null ? (
                  <span className="font-sans text-sm tracking-normal text-[var(--muted)]">
                    / mois
                  </span>
                ) : null}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                {item.description}
              </p>
              <div aria-hidden className="ui-divider-fade my-4" />
              <ul className="flex-1 space-y-2 text-sm text-[var(--foreground)]">
                {item.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <CheckIcon className="mt-0.5 h-4 w-4 text-[var(--accent)]" />
                    <span>{feature}</span>
                  </li>
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
                  disabled={
                    Boolean(busy) ||
                    (!isPremium && !acceptedImmediateExecution)
                  }
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
                    if (!acceptedImmediateExecution) {
                      setError(
                        "Cochez l’acceptation des CGV et la demande d’exécution immédiate (renonciation au délai de rétractation de 14 jours) avant le paiement.",
                      );
                      return;
                    }
                    void run(`checkout-${checkoutPlan}`, async () => {
                      const result = await startPlanCheckout(checkoutPlan, {
                        acceptedImmediateExecution: true,
                      });
                      if ("url" in result && result.url) {
                        window.location.href = result.url;
                      }
                    });
                  }}
                >
                  {busy === `checkout-${item.id}` ||
                  busy === `preview-${item.id}` ? (
                    <SpinnerIcon className="h-4 w-4" />
                  ) : null}
                  {busy === `preview-${item.id}`
                    ? "Calcul du prorata…"
                    : busy === `checkout-${item.id}`
                      ? "Redirection Stripe…"
                      : isPremium
                        ? `Passer à ${item.name}`
                        : `Choisir ${item.name}`}
                </Button>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="ui-card rounded-[var(--radius-xl)] p-6 sm:p-7">
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
