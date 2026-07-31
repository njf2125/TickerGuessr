import { ImageResponse } from "next/og";

export const alt = "TickerGuessr — guess the stock from its chart";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Fixed, hand-picked bar heights so the mark reads as "a candlestick chart"
// without depending on any live puzzle data (this renders at build/request
// time with no access to a specific day's game).
const CANDLES = [
  { h: 90, up: true },
  { h: 140, up: true },
  { h: 70, up: false },
  { h: 180, up: true },
  { h: 110, up: false },
  { h: 60, up: false },
  { h: 150, up: true },
  { h: 200, up: true },
  { h: 95, up: false },
  { h: 130, up: true },
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#030712",
          color: "white",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 14,
            marginBottom: 48,
          }}
        >
          {CANDLES.map((c, i) => (
            <div
              key={i}
              style={{
                width: 28,
                height: c.h,
                borderRadius: 4,
                backgroundColor: c.up ? "#22c55e" : "#ef4444",
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -1, display: "flex" }}>
          TickerGuessr
        </div>
        <div style={{ fontSize: 32, color: "#9ca3af", marginTop: 16, display: "flex" }}>
          Guess the stock from its chart — a new puzzle every day.
        </div>
      </div>
    ),
    { ...size }
  );
}
