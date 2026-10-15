import MarkdownIt from 'markdown-it';
import { parseDocument } from 'yaml';

const parser = new MarkdownIt({ html: true, linkify: true });

export interface NoteText {
  allowed: boolean;
  text: string;
  chunks: string[];
}

export function speechText(markdown: string): NoteText {
  let body = markdown.replace(/^\uFEFF/, '');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(body);
  if (frontmatter) {
    const document = parseDocument(frontmatter[1]);
    if (document.errors.length) throw new Error('笔记属性无法解析，请先修正 YAML。');
    if (document.get('tts') === false) return { allowed: false, text: '', chunks: [] };
    body = body.slice(frontmatter[0].length);
  }
  body = body.replace(/%%[\s\S]*?%%/g, '').replace(/!\[\[[^\]\n]+\]\]/g, '');
  const paragraphs: string[] = [];
  let tableDepth = 0;
  for (const token of parser.parse(body, {})) {
    if (token.type === 'table_open') tableDepth++;
    if (token.type === 'table_close') tableDepth--;
    if (tableDepth || token.type !== 'inline') continue;
    let skipLink = false;
    const parts: string[] = [];
    for (const child of token.children ?? []) {
      if (child.type === 'link_open') skipLink = child.markup === 'linkify' || child.markup === 'autolink';
      else if (child.type === 'link_close') skipLink = false;
      else if (!skipLink && (child.type === 'text' || child.type === 'code_inline')) parts.push(child.content);
      else if (child.type === 'softbreak' || child.type === 'hardbreak') parts.push(' ');
    }
    const paragraph = parts.join('')
      .replace(/\[\[([^\]\n]+)\]\]/g, (_match, target: string) => {
        const [path, alias] = target.split('|');
        return alias ?? path.split('#')[0].split('/').pop() ?? '';
      })
      .replace(/^\s*\[![^\]]+\]\s*/, '')
      .replace(/^\s*\[[ xX]\]\s*/, '')
      .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, '')
      .trim();
    if (paragraph) paragraphs.push(paragraph);
  }
  const text = paragraphs.join('\n\n');
  return { allowed: true, text, chunks: splitSpeech(text) };
}

export function splitSpeech(text: string, limit = 280): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Invalid chunk limit');
  const chunks: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[。！？.!?；;\n])/u)) {
    for (const character of Array.from(sentence)) {
      if (Array.from(current).length >= limit) {
        if (current.trim()) chunks.push(current.trim());
        current = '';
      }
      current += character;
    }
    if (Array.from(current).length >= limit / 2) {
      if (current.trim()) chunks.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function inFolder(path: string, folder: string, recursive = true): boolean {
  const normalized = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return true;
  if (!path.startsWith(`${normalized}/`)) return false;
  return recursive || !path.slice(normalized.length + 1).includes('/');
}

export function eligiblePath(path: string, includes: string[], excludes: string[], recursive: boolean): boolean {
  return path.endsWith('.md') && !excludes.some(folder => inFolder(path, folder)) &&
    includes.some(folder => inFolder(path, folder, recursive));
}

export class RandomRound {
  private seen = new Set<string>();

  next(candidates: string[], random = Math.random): string | null {
    const remaining = [...new Set(candidates)].filter(path => !this.seen.has(path));
    if (!remaining.length) return null;
    const path = remaining[Math.min(remaining.length - 1, Math.floor(random() * remaining.length))];
    this.seen.add(path);
    return path;
  }

  reset(): void { this.seen.clear(); }
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, value => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[value]!);
}

export async function digestText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}