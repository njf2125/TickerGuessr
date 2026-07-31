import Link from "next/link";

export function Footer() {
  return (
    <footer className="px-4 py-3 text-center text-[11px] leading-relaxed text-gray-500 border-t border-gray-800">
      <p>
        For entertainment purposes only — not financial or investment advice.
      </p>
      <p>
        <Link href="/privacy" className="underline hover:text-gray-300">
          Privacy
        </Link>
      </p>
    </footer>
  );
}
