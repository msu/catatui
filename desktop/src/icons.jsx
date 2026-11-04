// Icons for the file tree, like Windows Explorer: a folder, or a page with a colored label for the file type.

// File extension -> [label, color].
const TYPES = {
  py: ["PY", "#3776ab"], ipynb: ["NB", "#e67e22"],
  js: ["JS", "#c9a400"], mjs: ["JS", "#c9a400"], cjs: ["JS", "#c9a400"], jsx: ["JSX", "#1e9fc4"],
  ts: ["TS", "#3178c6"], tsx: ["TSX", "#3178c6"],
  html: ["</>", "#e34c26"], htm: ["</>", "#e34c26"], css: ["CSS", "#264de4"], scss: ["CSS", "#c6538c"],
  json: ["{ }", "#6b6b6b"], yaml: ["YML", "#6b6b6b"], yml: ["YML", "#6b6b6b"], toml: ["TOML", "#6b6b6b"], xml: ["XML", "#6b6b6b"],
  md: ["MD", "#455a64"], txt: ["TXT", "#78909c"], log: ["LOG", "#78909c"],
  java: ["JAVA", "#b07219"], kt: ["KT", "#7f52ff"], c: ["C", "#5c6bc0"], h: ["H", "#5c6bc0"], cpp: ["C++", "#00599c"], hpp: ["H++", "#00599c"],
  cs: ["C#", "#68217a"], go: ["GO", "#00add8"], rs: ["RS", "#b7410e"], rb: ["RB", "#cc342d"], php: ["PHP", "#777bb4"],
  swift: ["SW", "#f05138"], r: ["R", "#276dc3"], sql: ["SQL", "#336791"], lean: ["LEAN", "#4c6ef5"],
  sh: ["SH", "#2e7d32"], bash: ["SH", "#2e7d32"], zsh: ["SH", "#2e7d32"], ps1: ["PS", "#012456"], bat: ["BAT", "#4d4d4d"],
  xlsx: ["XLS", "#1d6f42"], xls: ["XLS", "#1d6f42"], csv: ["CSV", "#1d6f42"],
  docx: ["DOC", "#2b579a"], doc: ["DOC", "#2b579a"], pptx: ["PPT", "#d24726"], pdf: ["PDF", "#d32f2f"],
  png: ["IMG", "#8e44ad"], jpg: ["IMG", "#8e44ad"], jpeg: ["IMG", "#8e44ad"], gif: ["IMG", "#8e44ad"], svg: ["SVG", "#8e44ad"], webp: ["IMG", "#8e44ad"], ico: ["IMG", "#8e44ad"],
  zip: ["ZIP", "#795548"], gz: ["ZIP", "#795548"], tar: ["ZIP", "#795548"],
  lock: ["LOCK", "#9e9e9e"],
};

function typeOf(name) {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return ["DKR", "#2496ed"];
  if (lower === "makefile") return ["MK", "#6d4c41"];
  if (lower.startsWith(".git")) return ["GIT", "#f05032"];
  if (lower.startsWith(".env")) return ["ENV", "#9e9e9e"];
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  return TYPES[ext];
}

export function FileIcon({ name }) {
  const type = typeOf(name);
  const [label, color] = type ?? ["", "#9aa0a6"];
  const size = label.length > 3 ? 4.6 : 5.6;
  return (
    <svg className="ficon" viewBox="0 0 20 24" aria-hidden="true">
      <path d="M3 1.5h9.5L18 7v15.5H3z" fill="var(--page)" stroke="#9aa0a6" strokeWidth="1" />
      <path d="M12.5 1.5V7H18" fill="none" stroke="#9aa0a6" strokeWidth="1" />
      {type && (
        <>
          <rect x="0.5" y="12" width="17" height="8" rx="1.5" fill={color} />
          <text x="9" y="17.9" textAnchor="middle" fontSize={size} fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">{label}</text>
        </>
      )}
    </svg>
  );
}

export function FolderIcon({ open }) {
  return (
    <svg className="ficon" viewBox="0 0 24 20" aria-hidden="true">
      <path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h6l2 2.2h10a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 16z" fill="#d9a520" />
      {open
        ? <path d="M4 8h18.5l-2.3 9.5H1.8z" fill="#f5cc4f" />
        : <path d="M1.5 7h21v9a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 16z" fill="#f2c443" />}
    </svg>
  );
}
