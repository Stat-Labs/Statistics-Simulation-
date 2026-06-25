# StatLab

Intelligent statistical analysis platform. Upload a CSV, get instant analysis, AI interpretation, and a downloadable PDF report.

## What it does
- Parses any CSV dataset regardless of size
- Detects column types automatically
- Handles missing values intelligently (mean/median/mode/drop)
- Runs descriptive, inferential, and predictive analysis
- Auto-selects the right regression model for your data
- Generates plain-English AI interpretation
- Exports a formatted PDF report client-side

## Two modes
- **Smart Analyse** — AI picks the best analyses and charts
- **Manual Mode** — You choose exactly what to run

## Tech stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 App Router |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Data parsing | csv-parse (pure JS, zero native deps) |
| Statistics | simple-statistics |
| Regression models | ml-regression, ml-logistic-regression, ml-random-forest |
| AI interpretation | Groq → Mistral → Gemini → DeepSeek → HuggingFace (fallback chain) |
| PDF generation | jsPDF + html2canvas (client-side only) |

## Getting started

1. Clone the repo
2. Install dependencies:
   npm install
3. Copy env file:
   cp .env.local.example .env.local
4. Add at least one AI API key to .env.local
5. Run dev server:
   npm run dev

## Environment variables
| Variable | Required | Provider |
|----------|----------|---------|
| GROQ_API_KEY | Recommended | groq.com |
| MISTRAL_API_KEY | Optional | mistral.ai |
| GEMINI_API_KEY | Optional | ai.google.dev |
| DEEPSEEK_API_KEY | Optional | deepseek.com |
| HUGGINGFACE_API_KEY | Optional | huggingface.co |

At least one key must be set. Groq is recommended first — it is the fastest and has a generous free tier.

## API reference
See docs/API.md for full endpoint documentation.

## Who it's for
Anyone who works with tabular data — analysts, data scientists, ML engineers, students, and non-technical users who want instant insights from a CSV.

- **No prior statistics or coding needed.** Upload a CSV and click Smart Analyse.
- **Power users can go manual.** Pick exactly which analyses and models to run.
- **AI adapts to you, not the other way around.**

## Team
Built by the Department of Statistics, University of Benin for the Physical Science Innovation Competition 2026.
