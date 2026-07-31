import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const TITLE = "TickerGuessr — Daily Stock Ticker Guessing Game";
const DESCRIPTION =
  "Guess the mystery stock from its candlestick chart in 6 tries. A new stock market puzzle every day — free, no account needed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL("https://tickerguessr.app"),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://tickerguessr.app",
    siteName: "TickerGuessr",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
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
