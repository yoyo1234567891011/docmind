import type { AppNotification } from "@/types/notification";

/**
 * Email delivery channel — swap StubEmailChannel for Resend/SMTP later
 * without changing the dispatcher.
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

/**
 * Stub: does not send mail. Real provider will implement this interface.
 * Dispatcher enqueues to outbox instead of calling send() in production MVP.
 */
export class StubEmailChannel implements EmailChannel {
  readonly id = "email" as const;

  async send(): Promise<{ ok: boolean; error?: string }> {
    return {
      ok: false,
      error: "Email channel not configured (stub).",
    };
  }
}

export function createEmailChannel(): EmailChannel {
  // Future: if (process.env.RESEND_API_KEY) return new ResendEmailChannel(...)
  return new StubEmailChannel();
}

export function buildEmailContent(notification: AppNotification): {
  subject: string;
  body: string;
} {
  const subject = `[DocMind] ${notification.title}`;
  const body = [
    notification.title,
    "",
    notification.message,
    "",
    `Document : ${notification.documentTitle || notification.fileName}`,
    notification.dueDate ? `Échéance : ${notification.dueDate}` : null,
    "",
    "Ouvrez DocMind pour traiter cette notification.",
    `(Réf. analyse : ${notification.historyId})`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { subject, body };
}
