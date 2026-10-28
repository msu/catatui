// Animated MSU bobcat header. Plain ASCII only, so it renders in every terminal (Windows conhost too).
// The bobcat blinks and twitches its ears for a few seconds, then stops on the last frame.

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const FRAME_MS = 180;

// Every row is 19 columns wide. Ear tufts, eyes, and whiskers change.
const EARS = {
  up: "   /|         |\\   ",
  left: "   \\|         |\\   ",
  right: "   /|         |/   ",
};
const EYES = { open: " |    O     O    | ", half: " |    o     o    | ", shut: " |    -     -    | " };
const WHISKERS = { still: " (  >=   v   =<  ) ", flick: " ( =>=   v   =<= ) " };

function bobcat(ears: keyof typeof EARS, eyes: keyof typeof EYES, whiskers: keyof typeof WHISKERS): string[] {
  return [
    EARS[ears],
    "  /  \\_______/  \\  ",
    EYES[eyes],
    WHISKERS[whiskers],
    "  \\    \\___/    /  ",
    "   '-._______.-'   ",
  ];
}

const FRAMES = [
  bobcat("up", "open", "still"),
  bobcat("left", "open", "still"),
  bobcat("up", "open", "still"),
  bobcat("up", "half", "still"),
  bobcat("up", "shut", "still"),
  bobcat("up", "half", "still"),
  bobcat("up", "open", "flick"),
  bobcat("up", "open", "still"),
  bobcat("right", "open", "still"),
  bobcat("up", "open", "flick"),
  bobcat("up", "open", "still"),
];

const MSU = [
  "",
  " __  __   ____   _   _ ",
  "|  \\/  | / ___| | | | |",
  "| |\\/| | \\___ \\ | | | |",
  "| |  | |  ___) || |_| |",
  "|_|  |_| |____/  \\___/ ",
];

export function bannerLines(theme: Theme, version: string, frame: number): string[] {
  const gold = (s: string) => theme.bold(theme.fg("accent", s));
  const blue = (s: string) => theme.fg("border", s);
  const muted = (s: string) => theme.fg("muted", s);
  const dim = (s: string) => theme.fg("dim", s);
  const cat = FRAMES[Math.min(frame, FRAMES.length - 1)];
  return [
    "",
    ...cat.map((line, i) => `  ${blue(line)}  ${gold(MSU[i])}`),
    "",
    `  ${theme.bold("CatChat TUI")} ${dim(`v${version}`)}  ${muted("Montana State University")}`,
    `  ${dim("/login")} ${muted("sign in")}   ${dim("/model")} ${muted("pick a model")}   ${dim("/catchat")} ${muted("status")}   ${dim("/hotkeys")} ${muted("keys")}`,
    "",
  ];
}

export function bannerComponent(tui: TUI, theme: Theme, version: string) {
  let frame = 0;
  const timer = setInterval(() => {
    frame++;
    tui.requestRender();
    if (frame >= FRAMES.length - 1) clearInterval(timer);
  }, FRAME_MS);
  return {
    render: () => bannerLines(theme, version, frame),
    invalidate() {},
    dispose: () => clearInterval(timer),
  };
}
