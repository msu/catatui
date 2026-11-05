// The simple Markdown of docx_write and pdf_write, as blocks. Both writers use this parser, so they
// accept the same text and make the same structure (headings, lists, tables, images with alt text).
// See src/md/features/documents.md.

export interface Run { text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string }

export type Block =
  | { type: "heading"; level: number; runs: Run[]; text: string }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list"; ordered: boolean; items: Run[][] }
  | { type: "table"; rows: Run[][][] }
  | { type: "image"; alt: string; path: string }
  | { type: "code"; text: string };

// **bold**, *italic*, `code`, and [text](url) in one line.
export function parseRuns(text: string): Run[] {
  const out: Run[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/)) {
    if (!part) continue;
    let m: RegExpExecArray | null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) out.push({ text: part.slice(2, -2), bold: true });
    else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) out.push({ text: part.slice(1, -1), code: true });
    else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part))) out.push({ text: m[1], link: m[2] });
    else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) out.push({ text: part.slice(1, -1), italic: true });
    else out.push({ text: part });
  }
  return out;
}

export const plainText = (runs: Run[]) => runs.map((r) => r.text).join("");

const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export function parseMarkdown(markdown: string): Block[] {
  const out: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: "paragraph", runs: parseRuns(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const runs = parseRuns(h[2].trim());
      out.push({ type: "heading", level: h[1].length, runs, text: plainText(runs) });
      continue;
    }
    const img = IMAGE.exec(line.trim());
    if (img) { flush(); out.push({ type: "image", alt: img[1].trim(), path: img[2].trim() }); continue; }
    const item = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = !item[1];
      const last = out[out.length - 1];
      if (last?.type === "list" && last.ordered === ordered) last.items.push(parseRuns(item[3]));
      else out.push({ type: "list", ordered, items: [parseRuns(item[3])] });
      continue;
    }
    if (line.trim().startsWith("|")) {
      flush();
      const rows: Run[][][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        if (/^\|\s*:?-{2,}/.test(lines[i].trim())) continue; // the |---|---| line
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => parseRuns(c.trim())));
      }
      i--;
      out.push({ type: "table", rows });
      continue;
    }
    if (line.trim() === "") { flush(); continue; }
    para.push(line.trim());
  }
  flush();
  return out;
}

// Problems that make the document hard to use with a screen reader. The writers refuse to write with these.
export function structureErrors(blocks: Block[]): string[] {
  const errors: string[] = [];
  for (const b of blocks) {
    if (b.type === "image" && !b.alt) errors.push(`The image ${b.path} has no alt text. Write it as ![what the image shows](${b.path}).`);
    if (b.type === "table" && b.rows.length < 2) errors.push("A table must have a header row and at least one data row.");
  }
  return errors;
}

// Problems that the writers report but do not refuse.
export function structureWarnings(blocks: Block[]): string[] {
  const warnings: string[] = [];
  const headings = blocks.filter((b) => b.type === "heading");
  if (headings.length === 0 && blocks.length > 3) warnings.push("The document has no headings. Add # headings, so that screen reader users can move through it.");
  let prev = 0;
  for (const h of headings) {
    if (h.level > prev + 1) warnings.push(`The heading "${h.text}" is level ${h.level} after level ${prev}. Do not skip heading levels.`);
    prev = h.level;
  }
  if (headings.length && headings[0].level !== 1) warnings.push("The first heading is not a # (level 1) heading.");
  for (const b of blocks) {
    const runs = b.type === "paragraph" ? b.runs : b.type === "list" ? b.items.flat() : [];
    for (const r of runs) if (r.link && badLinkText(r.text)) warnings.push(`The link text "${r.text}" does not say where the link goes. Use words that name the target.`);
  }
  return warnings;
}

export const badLinkText = (t: string) => /^(click here|here|link|this|more|read more|this link)$/i.test(t.trim()) || /^https?:\/\//.test(t.trim());
