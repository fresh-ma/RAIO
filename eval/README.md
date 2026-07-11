# RAIO evaluation

Run the deterministic evidence-anchor check with:

```bash
npm run eval:evidence
```

The default fixture is deliberately small and only verifies the evaluation pipeline. Replace it with a human-labeled dataset using the same `pages` and `claims` schema before reporting research results. A claim is counted as supported only when its quoted snippet occurs on the stated page after whitespace and punctuation normalization.

The next benchmark should contain at least 30 manually checked papers and report evidence precision, recall, F1, unsupported-claim rate, PDF parse coverage, and full-text acquisition success rate by source.

