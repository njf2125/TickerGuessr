import type { RevenuePoint } from "@/types/game";

// Mirrors MAX_REVENUE_QUARTERS in scripts/fetch-financials-data.ts — that's the
// generator's cap on how many quarters end up in the payload at all, this is the
// client's cap on how many of them the reveal ever shows. They can't share a
// module (scripts/ runs under tsx, which can't resolve the `@/` alias this file
// imports), so if one changes, check whether the other needs to move with it.
export const MAX_VISIBLE_QUARTERS = 12;
export const UP_COLOR = "#22c55e";
export const DOWN_COLOR = "#ef4444";

const BASE_VISIBLE = 4;
const REVEAL_STEP = 2;

// Step is 2, not 4, on purpose: MAX_ATTEMPTS is 6, so a step of 4 would hit the
// 12-quarter cap by guess 2 and leave the chart frozen for four of six stages —
// exactly the "static wallpaper" problem the progressive reveal exists to fix,
// just delayed to when the game gets hard. See the design doc.
export function visibleQuarterCount(guessCount: number, dataLength: number): number {
  return Math.min(BASE_VISIBLE + guessCount * REVEAL_STEP, MAX_VISIBLE_QUARTERS, dataLength);
}

// Reveals backwards in time: the newest quarters are always on screen and never
// shift position, older history fills in leftward.
export function visibleSlice(data: RevenuePoint[], visibleCount: number): RevenuePoint[] {
  return data.slice(Math.max(0, data.length - visibleCount));
}

// Each bar is compared against its predecessor in the FULL array, never the
// visible slice — otherwise the leftmost visible bar (which has no visible
// predecessor) would flip color the moment more bars appear. A consequence worth
// knowing: the leftmost bar's color references a quarter the player can't see yet.
// Stable colors beat verifiable ones.
export function barColorsForVisible(data: RevenuePoint[], visibleCount: number): string[] {
  const startIdx = Math.max(0, data.length - visibleCount);
  return data.slice(startIdx).map((point, i) => {
    const fullIdx = startIdx + i;
    if (fullIdx === 0) return UP_COLOR; // no predecessor at all
    return point.y >= data[fullIdx - 1].y ? UP_COLOR : DOWN_COLOR;
  });
}
