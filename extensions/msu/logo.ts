// Pixel-art bobcat for terminals without an image protocol.
// Traced from a pixel-art version of the MSU bobcat logo.
// Each pixel is the main color of a 2x2 block of the trace. Three colors only: fewer color edges give fewer lines between rows.
// N = navy, G = gold, C = cream, . = empty.
// The art uses half blocks: one text row holds two pixel rows, so the row count must be even.

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

const COLORS: Record<string, [number, number, number]> = {
  N: [0, 31, 86],
  G: [199, 153, 78],
  C: [251, 246, 236],
};

const ROWS = ART.map((row) => [...row].map((c) => COLORS[c]));

const fg = ([r, g, b]: number[]) => `\x1b[38;2;${r};${g};${b}m`;
const bg = ([r, g, b]: number[]) => `\x1b[48;2;${r};${g};${b}m`;

function halfBlockLine(top: (number[] | undefined)[], bottom: (number[] | undefined)[]): string {
  let line = "";
  for (let x = 0; x < top.length; x++) {
    const t = top[x];
    const b = bottom[x];
    // If both pixels have the same color, draw a space on a background color.
    // A glyph edge can show a thin line between rows, but a background fills the full cell.
    if (t && b && t === b) line += bg(t) + " ";
    else if (t && b) line += fg(t) + bg(b) + "▀";
    else if (t) line += "\x1b[49m" + fg(t) + "▀";
    else if (b) line += "\x1b[49m" + fg(b) + "▄";
    else line += "\x1b[0m ";
  }
  return line + "\x1b[0m";
}

export const WIDTH = ROWS[0].length;

export const HALF_BLOCK: string[] = [];
for (let y = 0; y < ROWS.length; y += 2) HALF_BLOCK.push(halfBlockLine(ROWS[y], ROWS[y + 1]));
