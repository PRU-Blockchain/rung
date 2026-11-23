import type { Metadata } from "next";

import { COPY } from "@/lib/copy";

import "./globals.css";

// System fonts only: no external font, script or analytics.
export const metadata: Metadata = {
  title: "Rung",
  description: COPY.title,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
