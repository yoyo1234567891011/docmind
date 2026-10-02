import { siteConfig } from "@/config/site";
import {
  DEFAULT_RESEND_FROM_EMAIL,
  resolvePublicAppUrl,
} from "@/config/domains";
import type { AppNotification } from "@/types/notification";

/**
 * Email delivery channel — Resend si RESEND_API_KEY, sinon stub.
 */
export interface EmailChannel {
  readonly id: "email";
  send(input: {
    to: string;
    subject: string;
    body: string;
    notification: AppNotification;
  }): Promise<{ ok: boolean; error?: string }>;
}

export class StubEmailChannel implements EmailChannel {
  readonly id = "email" as const;

  async send(): Promise<{ ok: boolean; error?: string }> {
    return {
      ok: false,
      error: "Email channel not configured (stub).",
    };
  }
}

/**
 * Envoi via API Resend (https://resend.com).
 * Prérequis : domaine échélia.com vérifié + RESEND_API_KEY + RESEND_FROM_EMAIL.
 */
export class ResendEmailChannel implements EmailChannel {
  readonly id = "email" as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(input: {
    to: string;
    subject: string;
    body: string;
    notification: AppNotification;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [input.to],
          subject: input.subject,
          text: input.body,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Resend HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Échec d’envoi Resend.",
      };
    }
  }
}

export function createEmailChannel(): EmailChannel {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return new StubEmailChannel();
  const from =
    process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_RESEND_FROM_EMAIL;
  return new ResendEmailChannel(apiKey, from);
}

export function buildEmailContent(notification: AppNotification): {
  subject: string;
  body: string;
} {
  const brand = siteConfig.name;
  const appUrl = resolvePublicAppUrl();
  const subject = `[${brand}] ${notification.title}`;
  const body = [
    notification.title,
    "",
    notification.message,
    "",
    `Document : ${notification.documentTitle || notification.fileName}`,
    notification.dueDate ? `Échéance : ${notification.dueDate}` : null,
    "",
    `Ouvrez ${brand} : ${appUrl}`,
    `(Réf. analyse : ${notification.historyId})`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { subject, body };
}
