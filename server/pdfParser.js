import fs from 'fs/promises';
import { PDFParse } from 'pdf-parse';

const MAX_EVIDENCE_CONTEXT_CHARS = 90000;

function normalizeWhitespace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value = '') {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function inferPageTitle(text = '', pageNumber = 1) {
  const lines = String(text)
    .split('\n')
    .map(normalizeWhitespace)
    .filter(Boolean);
  const heading = lines.find(line => {
    if (line.length < 3 || line.length > 100) return false;
    return /^(abstract|introduction|background|related work|method|methodology|approach|experiment|results?|discussion|limitations?|conclusion|references|摘要|引言|背景|相关工作|方法|实验|结果|讨论|局限|结论)\b/i.test(line)
      || /^\d+(?:\.\d+)*\s+\S+/.test(line);
  });
  return heading || `第 ${pageNumber} 页`;
}

export async function parsePdfFile(filePath) {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const pages = (result.pages || [])
      .map((page, index) => ({
        page: Number(page.num || index + 1),
        title: inferPageTitle(page.text, Number(page.num || index + 1)),
        content: String(page.text || '').trim(),
      }))
      .filter(page => page.content);

    if (!pages.length) {
      throw new Error('PDF 未提取到可读文本，可能是扫描件或受保护文档');
    }

    return {
      pageCount: Number(result.total || pages.length),
      charCount: pages.reduce((sum, page) => sum + page.content.length, 0),
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

export function buildEvidenceContext(pages, maxChars = MAX_EVIDENCE_CONTEXT_CHARS) {
  let used = 0;
  const chunks = [];

  for (const page of pages || []) {
    const header = `\n[PAGE ${page.page}] ${page.title || ''}\n`;
    const remaining = maxChars - used - header.length;
    if (remaining <= 0) break;
    const content = String(page.content || '').slice(0, remaining);
    chunks.push(`${header}${content}`);
    used += header.length + content.length;
  }

  return chunks.join('\n');
}

export function extractJsonObject(value = '') {
  const text = String(value).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error('模型未返回有效 JSON');
  return JSON.parse(candidate);
}

export function validateEvidenceClaims(claims, pages) {
  const pageMap = new Map((pages || []).map(page => [Number(page.page), page]));

  return (Array.isArray(claims) ? claims : []).slice(0, 12).map((item, index) => {
    const pageNumber = Number(item?.page);
    const page = pageMap.get(pageNumber);
    const snippet = normalizeWhitespace(item?.snippet || item?.evidence || '');
    const haystack = normalizeForMatch(page?.content || '');
    const needle = normalizeForMatch(snippet);
    const verified = Boolean(page && needle.length >= 12 && haystack.includes(needle));

    return {
      claim: normalizeWhitespace(item?.claim || `结论 ${index + 1}`),
      page: Number.isFinite(pageNumber) ? pageNumber : null,
      snippet,
      evidence_type: normalizeWhitespace(item?.evidence_type || item?.type || 'other'),
      confidence: verified ? 'high' : 'low',
      verified,
      verification_note: verified
        ? '原文片段已在指定页匹配'
        : '未能在指定页精确匹配，需人工核验',
    };
  });
}

