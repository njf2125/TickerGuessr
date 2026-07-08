"use client";
import { useState, useRef, useCallback } from "react";
import { COMPANIES } from "@/data/companies";
import { Company } from "@/types/game";

interface SearchInputProps {
  onSubmit: (ticker: string) => void;
  disabled: boolean;
  guessedTickers: string[];
}

// Rank ticker matches ahead of name matches, and prefix matches ahead of
// substring matches, so typing "META" surfaces the META ticker first.
function matchRank(c: Company, q: string): number {
  const ticker = c.ticker.toUpperCase();
  const name = c.name.toUpperCase();
  if (ticker === q) return 0;
  if (ticker.startsWith(q)) return 1;
  if (ticker.includes(q)) return 2;
  if (name.startsWith(q)) return 3;
  return 4;
}

function matchCompanies(query: string, exclude: Set<string>): Company[] {
  if (!query.trim()) return [];
  const q = query.toUpperCase();
  return COMPANIES.filter(
    (c) =>
      !exclude.has(c.ticker) &&
      (c.ticker.toUpperCase().includes(q) || c.name.toUpperCase().includes(q))
  )
    .sort((a, b) => matchRank(a, q) - matchRank(b, q))
    .slice(0, 20);
}

export function SearchInput({ onSubmit, disabled, guessedTickers }: SearchInputProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      const matches = matchCompanies(val, new Set(guessedTickers));
      setResults(matches);
      setOpen(matches.length > 0);
      setHighlightedIndex(-1);
    },
    [guessedTickers]
  );

  const handleSelect = useCallback(
    (ticker: string) => {
      onSubmit(ticker);
      setQuery("");
      setResults([]);
      setOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.blur();
    },
    [onSubmit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = Math.min(prev + 1, results.length - 1);
          itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
        return;
      }
      if (e.key === "ArrowUp" && results.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
        return;
      }
      if (e.key === "Enter" && results.length > 0) {
        const ticker = highlightedIndex >= 0 ? results[highlightedIndex].ticker : results[0].ticker;
        handleSelect(ticker);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [results, highlightedIndex, handleSelect]
  );

  return (
    <div className="relative w-full">
      {open && (
        <ul className="absolute bottom-full mb-2 left-0 right-0 z-50 bg-gray-800 border border-gray-700 rounded-xl overflow-y-auto max-h-64 shadow-xl">
          {results.map((c, i) => (
            <li key={c.ticker} ref={(el) => { itemRefs.current[i] = el; }}>
              <button
                type="button"
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  i === highlightedIndex ? "bg-gray-700" : "hover:bg-gray-700"
                }`}
                onMouseEnter={() => setHighlightedIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(c.ticker);
                }}
              >
                <span className="font-mono font-bold text-sm text-white w-16 shrink-0">
                  {c.ticker}
                </span>
                <span className="text-sm text-gray-300 truncate">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        placeholder={disabled ? "Game over" : "Search ticker or company name…"}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
