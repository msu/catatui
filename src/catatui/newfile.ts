// New files from the desktop app: the tree menu "New" (desktop/main.js). Each kind has a small start file.
// The HTML, Word, and Excel files are accessible from the start: a title and a language, and a heading.
// See src/md/features/desktop.md.

import { DEFAULT_LANG, loadDocx } from "./documents.ts";

export interface NewKind { kind: string; label: string; ext: string }

// The order of the "New" submenu. A null is a separator.
export const NEW_KINDS: (NewKind | null)[] = [
  { kind: "folder", label: "Folder", ext: "" },
  null,
  { kind: "md", label: "Markdown", ext: ".md" },
  { kind: "txt", label: "Text", ext: ".txt" },
  null,
  { kind: "html", label: "Web page (HTML)", ext: ".html" },
  { kind: "css", label: "Style sheet (CSS)", ext: ".css" },
  { kind: "js", label: "JavaScript", ext: ".js" },
  { kind: "py", label: "Python", ext: ".py" },
  { kind: "json", label: "JSON", ext: ".json" },
  null,
  { kind: "xlsx", label: "Excel workbook", ext: ".xlsx" },
  { kind: "csv", label: "CSV (spreadsheet text)", ext: ".csv" },
  { kind: "docx", label: "Word document", ext: ".docx" },
];

export const newKind = (kind: string) => NEW_KINDS.find((k) => k?.kind === kind) ?? undefined;

// The file name: unsafe characters out, and the extension of the kind if the name has no extension of that kind.
// "my page" + html -> "my page.html". "notes.md" + md -> "notes.md". Empty: undefined.
export function newFileName(name: string, kind: NewKind): string | undefined {
  const clean = String(name ?? "").replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "").trim();
  if (!clean) return undefined;
  return !kind.ext || clean.toLowerCase().endsWith(kind.ext) ? clean : `${clean}${kind.ext}`;
}

// "budget-plan.xlsx" -> "Budget plan".
export function titleOf(file: string): string {
  const base = file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Untitled";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The content of a new file. Text kinds give a string, Excel and Word give bytes.
export async function newFileContent(kind: string, file: string): Promise<string | Buffer> {
  const title = titleOf(file);
  switch (kind) {
    case "md": return `# ${title}\n`;
    case "txt": return "";
    case "html":
      return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n` +
        `  <title>${esc(title)}</title>\n</head>\n<body>\n  <h1>${esc(title)}</h1>\n</body>\n</html>\n`;
    case "css": return `/* ${title} */\n`;
    case "js": return `// ${title}\n`;
    case "py": return `# ${title}\n`;
    case "json": return "{}\n";
    case "csv": return "";
    case "xlsx": {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.title = title;
      wb.addWorksheet("Sheet1");
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
    case "docx": {
      const d = await loadDocx();
      const doc = new d.Document({
        title,
        styles: { default: { document: { run: { language: { value: DEFAULT_LANG } } } } },
        sections: [{ children: [new d.Paragraph({ text: title, heading: d.HeadingLevel.HEADING_1 })] }],
      });
      return d.Packer.toBuffer(doc);
    }
    default: throw new Error(`catai cannot make a file of the kind "${kind}".`);
  }
}
