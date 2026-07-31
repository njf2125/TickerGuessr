import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — TickerGuessr",
};

export default function PrivacyPage() {
  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto p-6 gap-4 text-sm text-gray-300 leading-relaxed">
      <Link href="/" className="text-xs text-gray-500 underline hover:text-gray-300 w-fit">
        ← Back to game
      </Link>
      <h1 className="text-lg font-bold text-white">Privacy</h1>
      <p>
        TickerGuessr has no accounts, no sign-up, and no server-side database.
        Your guesses and stats are stored only in your browser&apos;s local
        storage and never sent anywhere.
      </p>
      <p>
        We use Cloudflare Web Analytics, a cookie-free analytics service, to
        see aggregate traffic like page views and referrers. It does not use
        cookies or track you individually across sites.
      </p>
      <p>
        Our hosting provider (Vercel) and Cloudflare may log standard request
        data such as IP address, as is normal for any website — we don&apos;t
        access or use this for anything beyond keeping the site running.
      </p>
      <p className="text-xs text-gray-500">
        Stock chart data is historical and provided for entertainment
        purposes only — not financial or investment advice.
      </p>
    </div>
  );
}
