import type { Metadata } from "next";
import { Instrument_Serif, Outfit } from "next/font/google";

import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { AppChrome } from "@/components/layout/app-chrome";
import { ThemeProvider } from "@/components/theme";
import { siteConfig } from "@/config/site";

import "./globals.css";

const outfit = Outfit({
  variable: "--font-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  metadataBase: process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL)
    : undefined,
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.description,
    locale: siteConfig.locale || "fr_FR",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${outfit.variable} ${instrumentSerif.variable} min-h-screen font-sans antialiased`}
        suppressHydrationWarning
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='docmind-theme';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          <PageViewTracker />
          <AppChrome>{children}</AppChrome>
        </ThemeProvider>
      </body>
    </html>
  );
}
