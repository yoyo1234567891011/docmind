import { docmindConfig } from "@/config/docmind";

export const siteConfig = {
  name: docmindConfig.site.name,
  description: docmindConfig.site.description,
  locale: docmindConfig.site.locale,
} as const;
