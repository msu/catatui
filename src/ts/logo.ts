// Pixel-art bobcat for terminals without an image protocol.
// Traced from a pixel-art version of the MSU bobcat logo.
// Each pixel is the main color of a 2x2 block of the trace.
// N = navy, G = gold, C = cream, . = empty.

import { foregroundAnsi, getTerminalColorMode, rgbColor } from "@earendil-works/pi-tui";

const ART = [
  "..................C......",
  ".................CNC.....",
  "...............CCNNN.....",
  "..............CCNNNN.....",
  ".............CNNNGNC.....",
  "...........CCNNGGGN......",
  ".........CCNNNGNGGNCC....",
  ".......CCNNNNNNNGGGNNC...",
  ".....CCNNNGGGNGNGGGGNN...",
  "....CCNNGGGGGGGGGGNGGNN..",
  "...CCNNGGGGGGNGGGGGNNGNC.",
  "..CNNNGGGGGGNGGGGGGGGNGNC",
  ".CNNGGGGNGGNNNGGGGGGGGCGN",
  "CNNNGGGNGGGGNGGGGCCCNNCCC",
  "CNNNNNNNGGGNNGGGGCCNCNNN.",
  "CNCCNNNNNNNNNGGCCCCNCCC..",
  ".C..CNNNNNNNNGNNNCCNNN...",
  ".....CGGGCNNNNNCCNCCCN...",
  "..........CNNNC.CNNNNC...",
  "...........CNNC...CNC....",
  "...........GNNC....C.....",
  "............GN...........",
  ".............G...........",
  ".........................",
];

type Rgb = [number, number, number];

// Dark terminals get green "matrix" pixels. Light terminals get MSU blue and gold, with gray for cream.
const PALETTES: Record<"dark" | "light", Record<string, Rgb>> = {
  dark: { N: [0, 143, 17], G: [0, 255, 65], C: [170, 255, 190] },
  light: { N: [22, 41, 96], G: [199, 153, 78], C: [160, 160, 160] },
};

export const WIDTH = ART[0].length;
export const HEIGHT = Math.ceil(ART.length / 2);

// One text row holds two pixel rows. A cell is drawn where its two pixels differ, so the edges show.
// Inside solid areas, it draws every second cell (a checkerboard).
// A cell draws one "▀" in the color of its top pixel, or its bottom pixel if the top is empty.
// The empty half of each cell gives the gaps between rows of pixels.
// The color goes through pi-tui, so terminals without 24-bit color get the nearest 256-color index.
export function logoLines(appearance: "dark" | "light"): string[] {
  const palette = PALETTES[appearance];
  const mode = getTerminalColorMode();
  const lines: string[] = [];
  for (let y = 0; y < ART.length; y += 2) {
    let line = "";
    for (let x = 0; x < WIDTH; x++) {
      const top = ART[y][x];
      const bottom = ART[y + 1]?.[x] ?? ".";
      const fill = (x + y / 2) % 2 === 0;
      const c = top === bottom && !fill ? undefined : (palette[top] ?? palette[bottom]);
      line += c ? `${foregroundAnsi(rgbColor(...c), mode)}▀\x1b[39m` : " ";
    }
    lines.push(line);
  }
  return lines;
}
