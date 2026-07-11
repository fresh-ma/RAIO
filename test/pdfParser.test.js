import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEvidenceContext,
  parsePdfFile,
  validateEvidenceClaims,
} from '../server/pdfParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('parsePdfFile extracts page-level text from the review PDF', async () => {
  const filePath = path.join(__dirname, '..', 'RAIO2修改要求.pdf');
  const result = await parsePdfFile(filePath);
  assert.equal(result.pageCount, 2);
  assert.ok(result.pages.length >= 2);
  assert.match(result.pages[0].content, /RAIO2/);
});

test('validateEvidenceClaims only verifies snippets present on the stated page', () => {
  const pages = [
    { page: 1, title: 'Method', content: 'We propose a retrieval method with two verification stages.' },
    { page: 2, title: 'Result', content: 'The method improves accuracy by 12 percent on Dataset A.' },
  ];
  const claims = validateEvidenceClaims([
    {
      claim: 'The method has two verification stages.',
      page: 1,
      snippet: 'retrieval method with two verification stages',
      evidence_type: 'method',
    },
    {
      claim: 'The method improves accuracy.',
      page: 1,
      snippet: 'improves accuracy by 12 percent',
      evidence_type: 'result',
    },
  ], pages);

  assert.equal(claims[0].verified, true);
  assert.equal(claims[1].verified, false);
  assert.equal(claims[1].confidence, 'low');
});

test('buildEvidenceContext preserves explicit page anchors', () => {
  const context = buildEvidenceContext([
    { page: 3, title: 'Limitations', content: 'This evaluation only covers English datasets.' },
  ]);
  assert.match(context, /\[PAGE 3\]/);
  assert.match(context, /English datasets/);
});

