"use client";
import { useEffect } from "react";

interface HowToModalProps {
  onClose: () => void;
}

export function HowToModal({ onClose }: HowToModalProps) {
  // Close on Escape — matches the backdrop-tap affordance below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold tracking-widest uppercase">How to Play</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-sm text-gray-300">
          Guess the mystery stock from its candlestick chart in <strong>6 tries</strong>.
        </p>
        <ul className="flex flex-col gap-2 text-sm text-gray-300">
          <li>📈 The chart starts bare — no axes, no labels.</li>
          <li>🔎 Search a ticker or company name and submit a guess.</li>
          <li>💡 Each wrong guess reveals more — grid, axes, sector, market cap, trivia, and finally the starting letter.</li>
          <li>🟩 Solve it before you run out of attempts. A new puzzle drops daily.</li>
        </ul>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
