# File Studio Backend

Express + MongoDB backend for the File Studio project.

Quick start

1. Install dependencies:

```bash
cd backend
npm install
```

2. Copy `.env.example` to `.env` and set `MONGODB_URI`.

3. Start in development:

```bash
npm run dev
```

API

- `GET /api/ping` — healthcheck
- `POST /api/files` — upload a file (multipart form with `file` and optional `metadata` JSON string)
- `GET /api/files` — list recent files
- `GET /api/files/:id` — get file metadata
- `DELETE /api/files/:id` — remove file and metadata
- `POST /api/ai` — run Northstar AI (Gemini) on extracted PDF text. Body: `{ feature, text, pages?, question? }` where `feature` is `summary`, `keypoints`, `notes`, `mcqs`, `explain`, or `ask`.

Uploaded files are stored in `backend/uploads` and metadata in MongoDB.

Northstar AI calls the Gemini API with `GEMINI_API_KEY` (backend env only). If the key is missing, `POST /api/ai` returns `503`.
