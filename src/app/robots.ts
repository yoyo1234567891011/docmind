import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/confidentialite",
        "/cgu",
        "/cgv",
        "/mentions-legales",
        "/auth/login",
        "/auth/signup",
      ],
      disallow: [
        "/api/",
        "/admin",
        "/dashboard",
        "/analyser",
        "/documents",
        "/historique",
        "/facturation",
        "/profil",
        "/logs",
        "/abonnements",
        "/finances",
        "/economies",
        "/contreparties",
        "/alertes",
        "/recherche",
        "/feedback",
        "/signalement",
        "/dossiers",
      ],
    },
    sitemap: appUrl ? `${appUrl}/sitemap.xml` : undefined,
  };
}
