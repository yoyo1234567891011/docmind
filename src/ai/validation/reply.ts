import { AppError } from "@/lib/errors";

import { asString, asStringArray, parseJsonObject } from "@/ai/validation/json";

import { LETTER_TYPES, type LetterType, type ReadyReply } from "@/types";



function parseLetterType(value: unknown): LetterType | undefined {

  const raw = String(value ?? "").trim();

  if ((LETTER_TYPES as string[]).includes(raw)) {

    return raw as LetterType;

  }

  return undefined;

}



export function parseReadyReplyResponse(

  raw: string,

  fallbackReason: string,

): ReadyReply {

  try {

    const parsed = parseJsonObject<Partial<ReadyReply>>(raw);

    const body = asString(parsed.body);

    const subject = asString(parsed.subject);



    if (!body) {

      throw new AppError(

        "ANALYSIS_FAILED",

        "Le courrier généré est vide.",

        502,

      );

    }



    return {

      required: true,

      reason: asString(parsed.reason) || fallbackReason,

      subject: subject || "Réponse à votre courrier",

      body,

      letterType: parseLetterType(parsed.letterType),

      recipient: asString(parsed.recipient) || "",

      factsUsed: asStringArray(parsed.factsUsed).slice(0, 12),

    };

  } catch (error) {

    if (error instanceof AppError) {

      throw error;

    }



    throw new AppError(

      "ANALYSIS_FAILED",

      "Impossible d'interpréter le courrier généré par le modèle.",

      502,

    );

  }

}


