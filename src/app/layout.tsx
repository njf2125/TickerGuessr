import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const DESCRIPTION =
  "Guess the stock ticker from the chart — a new puzzle every day.";

export const metadata: Metadata = {
  title: "TickerGuessr",
  description: DESCRIPTION,
  metadataBase: new URL("https://tickerguessr.app"),
  openGraph: {
    title: "TickerGuessr",
    description: DESCRIPTION,
    url: "https://tickerguessr.app",
    siteName: "TickerGuessr",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TickerGuessr",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        {children}
        <Script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "590e72afcd2442479e1cd6b88451a1f1"}'
        />
      </body>
    </html>
  );
}
