# StatLab Route Map

## Stats pipeline (Python backend)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /analyse | CORS | FastAPI computation engine — parses CSV, handles missing values, runs descriptive + inferential + predictive computation. Proxied by the Next route below. |

## Next.js API routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/analyse | Session | Proxies all statistics to the FastAPI backend (`PYTHON_BACKEND_URL`) |
| POST | /api/profile | Session | AI profiler — analysis map + chart suggestions |
| POST | /api/interpret | Session | AI interpretation of computed results. Retrieves workspace memory before answering. Always 200 — graceful fallback |
| POST | /api/auth/register | — | Create account (personal / enterprise) |
| POST | /api/auth/login | — | Sign in |
| POST | /api/auth/logout | Session | Sign out |
| GET | /api/auth/session | Session | Current session/user |
| POST | /api/auth/invite | Session | Invite an org member |
| POST | /api/auth/invite/accept | Session | Accept an invite |
| POST | /api/auth/members | Session | Manage org members |
| POST | /api/detect-codes | Session | Detect numeric/ISO code columns |
| POST | /api/datasets | Session | List datasets |
| GET | /api/uploads | Session | In-progress chunked uploads (resume) |
| POST | /api/uploads | Session | Start a chunked upload session |
| POST | /api/uploads/[id]/chunks | Session | Upload one chunk (idempotent) |
| POST | /api/uploads/[id]/complete | Session | Merge chunks, verify SHA-256, persist dataset (dedupes) |
| GET / DELETE | /api/uploads/[id] | Session | Resume status / cancel + cleanup |
| GET | /api/analyses | Session | List saved analyses |
| POST | /api/analyses | Session | Persist a completed analysis to object storage |
| GET | /api/memory/summary | Session | Workspace knowledge overview (findings, KPIs, glossary, datasets) |
| POST | /api/memory/query | Session | RAG retrieval — ranked context for a question |
| POST | /api/memory/ask | Session | Retrieval-before-answer: grounded LLM answer citing workspace memory |
| POST | /api/memory/extract | Session | Extract findings/glossary/KPIs from an analysis into memory |
| GET / POST | /api/settings/keys | Session | BYOK AI keys (encrypted at rest) |
| POST | /api/settings/preferred | Session | Preferred AI provider |
| GET | /api/profile | Session | Current profile |
| POST | /api/visualize | Session | Proxies to the FastAPI `/visualize` endpoint to retrieve a deterministic ECharts dashboard |
| GET | /visualize | Session | Visualization Intelligence interactive dashboard UI |