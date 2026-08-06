import { runLetterAgent } from "@/ai/agents/letter-agent";

import type { OllamaGenerateResult } from "@/ai/models/types";

import { assessReplyNeed } from "@/services/reply/detect";

import {

  EMPTY_READY_REPLY,

  type DocumentAnalysis,

  type DocumentClassification,

  type DocumentSheet,

  type LetterType,

  type ReadyReply,

} from "@/types";



interface GenerateReadyReplyInput {

  documentText: string;

  analysis: DocumentAnalysis;

  classification: DocumentClassification;

  sheet?: DocumentSheet | null;

  letterType?: LetterType | "auto";

  /** Si true, génère même si aucune réponse n’est détectée comme nécessaire. */

  force?: boolean;

}



/**

 * Pipeline courrier : détection du besoin → agent rédacteur (infos extraites).

 */

export async function generateReadyReply({

  documentText,

  analysis,

  classification,

  sheet,

  letterType,

  force,

}: GenerateReadyReplyInput): Promise<ReadyReply> {

  const result = await generateReadyReplyWithMeta({

    documentText,

    analysis,

    classification,

    sheet,

    letterType,

    force,

  });

  return result.readyReply;

}



export async function generateReadyReplyWithMeta({

  documentText,

  analysis,

  classification,

  sheet,

  letterType,

  force = false,

}: GenerateReadyReplyInput): Promise<{

  readyReply: ReadyReply;

  generation: OllamaGenerateResult | null;

  letterType?: LetterType;

  source?: "llm" | "fallback";

}> {

  const need = assessReplyNeed(documentText, analysis, classification);



  if (!force && !need.required && !letterType) {

    return {

      readyReply: {

        ...EMPTY_READY_REPLY,

        reason: need.reason,

      },

      generation: null,

    };

  }



  const agent = await runLetterAgent({

    documentText,

    analysis,

    classification,

    sheet,

    letterType: letterType ?? "auto",

  });



  return {

    readyReply: {

      ...agent.letter,

      reason: agent.letter.reason || need.reason || agent.suggestionReason,

    },

    generation: agent.generation,

    letterType: agent.letterType,

    source: agent.source,

  };

}


