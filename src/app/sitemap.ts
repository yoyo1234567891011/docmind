import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:3000";
  const now = new Date();
  const paths: Array<{ path: string; priority: number; freq: "weekly" | "monthly" }> = [
    { path: "/", priority: 1, freq: "weekly" },
    { path: "/guide", priority: 0.7, freq: "monthly" },
    { path: "/confidentialite", priority: 0.4, freq: "monthly" },
    { path: "/cgv", priority: 0.4, freq: "monthly" },
    { path: "/cgu", priority: 0.4, freq: "monthly" },
    { path: "/mentions-legales", priority: 0.4, freq: "monthly" },
    { path: "/cookies", priority: 0.3, freq: "monthly" },
    { path: "/auth/login", priority: 0.5, freq: "monthly" },
    { path: "/auth/signup", priority: 0.5, freq: "monthly" },
  ];
  return paths.map(({ path, priority, freq }) => ({
    url: `${base}${path === "/" ? "/" : path}`,
    lastModified: now,
    changeFrequency: freq,
    priority,
  }));
}
