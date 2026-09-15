// A small HTML → Markdown converter for the export. It covers what the editor
// can actually produce (paragraphs, bold/italic/strike, lists, links,
// headings) and names the media a text file cannot carry, so a .md reads the
// way the note did. Not a general converter: anything it doesn't know just
// contributes its text.

import type { Note } from './types';

/** `**bold**` must hug its text; move surrounding spaces outside the marks. */
function wrap(text: string, mark: string): string {
  const core = text.trim();
  if (!core) return text;
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  return `${lead}${mark}${core}${mark}${trail}`;
}

/** Phrasing content: one string, line breaks preserved. */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const inner = () => Array.from(el.childNodes).map(inline).join('');
  switch (el.tagName.toLowerCase()) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return wrap(inner(), '**');
    case 'em':
    case 'i':
      return wrap(inner(), '_');
    case 's':
    case 'del':
    case 'strike':
      return wrap(inner(), '~~');
    case 'code':
      return wrap(inner(), '`');
    case 'a': {
      const href = el.getAttribute('href');
      const text = inner().trim();
      return href ? `[${text || href}](${href})` : text;
    }
    case 'img':
      return '[image]';
    case 'audio':
      return '[voice memo]';
    default:
      return inner();
  }
}

/** Block content: one string per block, each line already indented. */
function blocks(el: Element, indent = ''): string[] {
  const out: string[] = [];
  // Adjacent text nodes each keep their own edge space, so runs collapse here.
  const para = (text: string) => {
    const t = text.replace(/ {2,}/g, ' ').trim();
    if (t) out.push(indent + t.replace(/\n/g, '\n' + indent));
  };
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      para(child.textContent ?? '');
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const e = child as Element;
    const tag = e.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) para('#'.repeat(+tag[1]) + ' ' + inline(e).trim());
    else if (tag === 'ul' || tag === 'ol') out.push(list(e, indent));
    else if (tag === 'blockquote') out.push(blocks(e).join('\n\n').replace(/^/gm, indent + '> '));
    else if (tag === 'pre') out.push([indent + '```', e.textContent ?? '', indent + '```'].join('\n'));
    else if (tag === 'hr') out.push(indent + '---');
    else para(inline(e)); // p, div, a bare <audio>/<img>, anything else
  }
  return out;
}

/**
 * One block for the whole list. The editor wraps each item's text in a <p>,
 * with any nested list beside it, so an item is itself a run of blocks: the
 * first takes the marker, the rest sit indented under it.
 */
function list(el: Element, indent: string): string {
  const ordered = el.tagName.toLowerCase() === 'ol';
  const lines: string[] = [];
  let n = 0;
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    n += 1;
    const marker = ordered ? `${n}. ` : '- ';
    const inner = blocks(li, indent + '  ');
    if (!inner.length) {
      lines.push(indent + marker);
      continue;
    }
    lines.push(indent + marker + inner[0].trimStart(), ...inner.slice(1));
  }
  return lines.join('\n');
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return blocks(doc.body).join('\n\n').trim();
}

/** The whole note as a document: title as the heading, then the body. */
export function noteToMarkdown(note: Pick<Note, 'title' | 'contentHtml'>): string {
  const title = note.title.trim() || 'Untitled note';
  const body = htmlToMarkdown(note.contentHtml);
  return `# ${title}\n` + (body ? `\n${body}\n` : '');
}
