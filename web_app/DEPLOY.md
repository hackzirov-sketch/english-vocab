# Deploy Guide

This app needs a Node server because vocabulary, quiz, grammar, and AI routes read from the SQLite database.

## Free Render Deploy

1. Push the repository to GitHub.
2. Open Render and choose **New Web Service**.
3. Connect the repository.
4. Render can read the root `render.yaml` automatically.
5. Add environment variables:
   - `APP_PASSWORD_HASH`
   - `OPENROUTER_API_KEY` if AI replies should work online
   - `OPENROUTER_MODEL` optional, default is `openai/gpt-4o-mini`
6. Deploy.

Render settings from `render.yaml`:

```text
Build: cd web_app && npm ci && npm run deploy:check
Start: cd web_app && npm start
Health: /healthz
```

## UptimeRobot Ping

Use this URL in UptimeRobot:

```text
https://your-render-app.onrender.com/healthz
```

Recommended monitor settings:

```text
Monitor Type: HTTP(s)
Interval: 5 minutes
Keyword: ok
```

This endpoint does not require login and does not load the full web app.

## Telegram Bot Web App

After Render gives an HTTPS URL, set it in the bot environment:

```env
WEB_APP_URL=https://your-render-app.onrender.com
```

Then restart the bot.

## Local Check Before Deploy

```bat
cd web_app
npm install
npm run deploy:check
npm start
```

Open:

```text
http://localhost:4173
```

Health check:

```text
http://localhost:4173/healthz
```
