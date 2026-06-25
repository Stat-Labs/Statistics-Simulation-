# StatLab Route Map

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/analyse | None | Parses CSV, handles missing values, runs descriptive + inferential + predictive computation |
| POST | /api/profile | None | AI profiler — returns analysis map and chart suggestions for Smart Analyse mode |
| POST | /api/interpret | None | AI interpretation of computed results. Always returns 200 — graceful fallback if AI unavailable |
| — | lib/stats/parser.ts | None | CSV parsing, schema detection, missing value handling |
| — | lib/stats/inferential.ts | None | Correlation, hypothesis testing, ANOVA |
| — | lib/stats/predictive.ts | None | Auto model selection and all regression types |
| — | lib/ai/providerChain.ts | None | AI provider fallback chain (Groq → Mistral → Gemini → DeepSeek → HuggingFace) with JSON response validation |
| — | lib/pdf/generator.ts | None | Client-side PDF generation |
| — | lib/pdf/usePDFExport.ts | None | React hook for PDF export |