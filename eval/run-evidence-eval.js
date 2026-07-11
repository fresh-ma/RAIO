import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidenceClaims } from '../server/pdfParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const datasetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'fixtures', 'evidence-sample.json');

const dataset = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
const actual = validateEvidenceClaims(dataset.claims, dataset.pages);
const rows = actual.map((item, index) => ({
  claim: item.claim,
  expected: Boolean(dataset.claims[index].expected_verified),
  actual: item.verified,
  correct: Boolean(dataset.claims[index].expected_verified) === item.verified,
}));
const correct = rows.filter(row => row.correct).length;
const predictedSupported = rows.filter(row => row.actual).length;
const trueSupported = rows.filter(row => row.expected).length;
const truePositive = rows.filter(row => row.actual && row.expected).length;
const precision = predictedSupported ? truePositive / predictedSupported : 1;
const recall = trueSupported ? truePositive / trueSupported : 1;
const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;

console.log(JSON.stringify({
  dataset: dataset.name || path.basename(datasetPath),
  samples: rows.length,
  accuracy: correct / Math.max(rows.length, 1),
  precision,
  recall,
  f1,
  rows,
}, null, 2));

if (correct !== rows.length) process.exitCode = 1;

