# English Vocabulary Master Web App

Personal web app for the vocabulary database.

## Run locally

```bat
cd web_app
npm install
npm start
```

Open:

```text
http://localhost:4173
```

## Environment

The server reads API keys from environment variables or from existing `bot/.env` / `backend/.env`.

Useful variables:

```env
DB_PATH=../database/master_maximal_v14_openrouter_ready.db
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
WEB_APP_URL=https://your-deployed-site.example
```

For Telegram Web App usage, deploy to an HTTPS URL and set `WEB_APP_URL` in `bot/.env`.

## Deploy

The app is ready for Render free hosting from the repository root with `render.yaml`.

Before deploying:

```bat
cd web_app
npm run deploy:check
```

More details: `DEPLOY.md`.

For UptimeRobot, ping:

```text
https://your-render-app.onrender.com/healthz
```

## Structured lesson content

The lesson generator combines the existing 1,624-record workbook knowledge base with app-ready content:

- 60 topic-matched Speaking lessons
- 100 structured Grammar records for advanced Speaking and Writing lessons
- level-safe offline fallbacks that do not force C1/C2 formulas into beginner Writing lessons
