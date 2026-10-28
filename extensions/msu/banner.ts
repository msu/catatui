// MSU bobcat header.
// Terminals with the Kitty or iTerm2 image protocol get assets/bobcat-head.png.
// Other terminals get the pixel art in logo.ts, shown from top to bottom.

import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, Image, type TUI } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { HALF_BLOCK, WIDTH } from "./logo.ts";

const FRAME_MS = 40;
const ROWS_PER_FRAME = 1;
const LOGO_PNG = new URL("../../assets/bobcat-head.png", import.meta.url);

function sideText(theme: Theme, version: string): string[] {
  const gold = (s: string) => theme.bold(theme.fg("accent", s));
  const muted = (s: string) => theme.fg("muted", s);
  const dim = (s: string) => theme.fg("dim", s);
  return [
    `${gold("CataTUI")} ${dim(`v${version}`)}`,
    muted("Montana State Command Line Agent"),
    "",
    `${dim("/login catchat")}  ${muted("sign in")}`,
    `${dim("/model")}          ${muted("pick a model")}`,
    `${dim("/catchat")}        ${muted("status")}`,
    `${dim("/hotkeys")}        ${muted("keys")}`,
  ];
}

// Half-block logo with the text at its right, at its vertical middle.
// In a narrow terminal, the text goes under the logo.
export function halfBlockLines(theme: Theme, version: string, shown: number, width = Infinity): string[] {
  const side = sideText(theme, version);
  const narrow = width < WIDTH + 30;
  const top = Math.floor((HALF_BLOCK.length - side.length) / 2);
  const lines = HALF_BLOCK.map((art, i) => {
    const logo = i < shown ? art : " ".repeat(WIDTH);
    const extra = narrow ? undefined : side[i - top];
    return extra === undefined ? `  ${logo}` : `  ${logo}   ${extra}`;
  });
  if (narrow) lines.push("", ...side.map((l) => `  ${l}`));
  return ["", ...lines, ""];
}

function imageHeader(theme: Theme, version: string) {
  const image = new Image(readFileSync(LOGO_PNG).toString("base64"), "image/png", { fallbackColor: (s) => theme.fg("dim", s) }, {
    maxWidthCells: WIDTH,
    maxHeightCells: HALF_BLOCK.length,
  });
  return {
    render: (width: number) => ["", ...image.render(width).map((l) => `  ${l}`), "", ...sideText(theme, version).map((l) => `  ${l}`), ""],
    invalidate: () => image.invalidate(),
  };
}

function halfBlockHeader(tui: TUI, theme: Theme, version: string) {
  let shown = 0;
  const timer = setInterval(() => {
    shown = Math.min(HALF_BLOCK.length, shown + ROWS_PER_FRAME);
    tui.requestRender();
    if (shown >= HALF_BLOCK.length) clearInterval(timer);
  }, FRAME_MS);
  return {
    render: (width: number) => halfBlockLines(theme, version, shown, width),
    invalidate() {},
    dispose: () => clearInterval(timer),
  };
}

export function bannerComponent(tui: TUI, theme: Theme, version: string) {
  return getCapabilities().images ? imageHeader(theme, version) : halfBlockHeader(tui, theme, version);
}
