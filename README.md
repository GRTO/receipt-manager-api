# Receipt Manager API

Standalone Node.js API for the Receipt Manager Expo app. The server is written in TypeScript and runs as compiled JavaScript.

## Requirements

- Node.js 24 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

The API listens on `http://127.0.0.1:3000` by default. `GET /health` returns `{ "status": "ok" }`. Set `HOST` and `PORT` as environment variables to change the address; `.env.example` lists the defaults. The server does not automatically load `.env`.

```bash
npm run typecheck
npm test
npm run build
npm start
```

## Scope of this first step

This repository currently provides the server foundation and a tested health route. It has no receipt data, authentication, database, image storage, or OCR yet. The [frontend plan](../receipt-manager/README.md) describes the proposed API and implementation sequence.

Next, decide whether the first release includes households and choose a sign-in method. Then add PostgreSQL migrations, authentication, and the first receipt routes with an OpenAPI contract.
