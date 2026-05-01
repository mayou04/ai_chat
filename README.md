# Human–AI Identity Guessing Chat (Imitation Game)

Real-time, turn-based chat game that pairs you with either another user or an LLM bot. After the conversation ends, both sides submit a guess: **Human** or **AI**.

## Website Hosted
If this is still up, it's hosted on `https://bot-or-human-cse-312.onrender.com/`

## Features

- Real-time messaging over Socket.io with pairing + disconnect handling
- Turn-based chat flow with timers and per-session limits
- AI opponent powered by Google Gemini (Gemma) via an Express API
- Prompt templating + randomized “personality” presets
- Post-chat identity guess collection

## Tech Stack

- Frontend: Vite + React + TypeScript, `socket.io-client`
- Backend: Node.js + Express + Socket.io
- AI: Google Gemini API (Gemma model)

## Local Development

### Prerequisites

- Node.js (recommended: 18+)

### Setup

All app code lives in `root/`.

1) Install dependencies

```bash
cd root
npm install
```

2) Configure environment variables

Create `root/.env` (or copy from `root/.env.example`) and set:

```bash
GEMINI_API_KEY=YOUR_KEY_HERE
```

### Run (2 terminals)

Terminal 1 (Socket.io + Express API on port 3001):

```bash
cd root
node server.js
```

Terminal 2 (Vite dev server on port 5173):

```bash
cd root
npm run dev
```

Open the app at the URL printed by Vite (typically `http://localhost:5173`).

## Production Build

```bash
cd root
npm run build
```

Then run the server in production mode so it serves `dist/`:

```bash
cd root
set NODE_ENV=production
node server.js
```

The server listens on `PORT` (defaults to `3001`).

## How It Works (High Level)

- The frontend initiates a session when you click **Start Chat**.
- For **human vs. human** sessions, the Socket.io server matches two waiting clients and emits pairing metadata.
- For **human vs. AI** sessions, the client generates bot responses by calling `POST /api/gemini`.
- The AI prompt is assembled from:
	- `root/src/assets/prompt.txt` (template)
	- `root/src/assets/personalities.txt` (randomized personality blocks)

## Socket Events

Client → Server

- `choose role` — identifies the client role for masking/partner metadata
- `join chat` — enter the matchmaking queue
- `chat message` — send a message (server relays and echoes)
- `submit guess` — submit identity guess after the chat

Server → Client

- `waiting` — queued for a match
- `paired` — matched with a partner (includes who goes first)
- `chat message` — delivered messages (including echo)
- `partner guess` — partner’s submitted guess
- `partner disconnected` — partner dropped mid-chat

## Configuration Notes

- Vite proxies `/api/*` to the backend server during development (see `root/vite.config.ts`).
- Chat limits/timers are implemented as constants in `root/src/App.tsx`.