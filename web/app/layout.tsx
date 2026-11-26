import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Roboto } from "next/font/google";

import { COPY } from "@/lib/copy";

import "./globals.css";

// Fonts are self-hosted by next/font: downloaded at build time and served from
// this site, so the visitor's browser makes no request to another domain.
// Still no external script and no analytics.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

// The link preview (chat apps, X) takes its title and text from here; the picture is the Rung mark.
export const metadata: Metadata = {
  metadataBase: new URL("https://rungbot.xyz"),
  title: "Rung",
  description: COPY.title,
  openGraph: { type: "website", url: "/", siteName: "Rung", title: "Rung", description: COPY.title, images: ["/icon.png"] },
  twitter: { card: "summary", title: "Rung", description: COPY.title, images: ["/icon.png"] },
};

export const viewport: Viewport = {
  themeColor: "#0B0D10",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the inline script in app/page.tsx sets the phone's scale (--pz) on <html> before React
    // hydrates; that style attribute is not React's.
    <html lang="en" className={`${archivo.variable} ${roboto.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
