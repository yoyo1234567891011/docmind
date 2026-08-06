import { extractAmounts } from "@/services/extraction/amounts";
import { extractDates, pickPrimaryDate } from "@/services/extraction/dates";
import { extractDeadlines } from "@/services/extraction/deadlines";
import {
  extractOrganizations,
  extractPeople,
} from "@/services/extraction/people-orgs";

export interface ExtractedEntities {
  amounts: string[];
  dates: string[];
  primaryDate: string;
  deadlines: string[];
  people: string[];
  organizations: string[];
}

/**
 * Deterministic extraction of amounts, dates, deadlines, people and orgs.
 */
export function extractDocumentEntities(text: string): ExtractedEntities {
  const amounts = extractAmounts(text);
  const dates = extractDates(text);
  const deadlines = extractDeadlines(text);

  return {
    amounts,
    dates,
    primaryDate: pickPrimaryDate(dates),
    deadlines,
    people: extractPeople(text),
    organizations: extractOrganizations(text),
  };
}
