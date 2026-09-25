# ✍️ NoteCraft AI

**Turn any YouTube lecture into beautiful handwritten study notes.**

NoteCraft AI is a production-grade application that processes YouTube lectures, extracts or transcribes their content, generates structured study notes using AI (with extractive fallback), and renders them as attractive handwritten notebook pages.

## Features

- 🎬 **YouTube Integration** — Paste any YouTube lecture URL
- 📝 **Multi-source Transcription** — Captions → Whisper fallback
- 🧠 **AI-Powered Notes** — Ollama integration with extractive fallback
- ✍️ **Handwritten Style** — Notes look like real student notebooks
- 🎯 **Exam Mode** — Focused revision-ready notes
- 📊 **Auto Diagrams** — Detects topic and generates relevant visuals
- 🌐 **Multi-language** — English, Hindi, Hinglish
- 📤 **Export** — Print/PDF, HTML, Markdown, Plain Text
- 📚 **History** — Saved notes persist across sessions
- 🔄 **Never Gets Stuck** — Every operation has timeouts and fallbacks
- ✨ **Demo Mode** — Works offline without any external tools

## Quick Start

### Windows

```
setup.bat
START.bat
```

### Manual

```bash
npm install
node server.mjs
```

Open http://localhost:3000

## Publish Online

The app includes a `Dockerfile`, so it can run on any host that supports Docker, including Render, Railway, Fly.io, Google Cloud Run, and a VPS.

```bash
docker build -t notecraft-ai .
docker run --rm -p 3000:3000 -v notecraft-data:/app/data notecraft-ai
```

Open `http://localhost:3000` locally, or use the public URL provided by your hosting service. The server reads the platform's `PORT` value and listens on `0.0.0.0` for external traffic.

For production, mount `/app/data` as a persistent volume so saved notes and history survive redeployments. Set `OLLAMA_URL` and `OLLAMA_MODEL` only if you are connecting to an external Ollama service; the built-in extractor works without Ollama.

### Vercel

Vercel deployment is configured through `vercel.json` and `api/index.mjs`:

```bash
npx vercel
```

Vercel's filesystem is read-only except for `/tmp`, so temporary jobs and fallback history use `/tmp/notecraft-ai` there. That storage is ephemeral. For durable history and reliable long-running Whisper/audio jobs, deploy the Docker image on Render, Railway, Fly.io, Cloud Run, or a VPS instead.

## Requirements

### Required
- **Node.js** 18+ — [Download](https://nodejs.org)

### Required for YouTube Processing
- **yt-dlp** — `pip install yt-dlp`
- **FFmpeg** — [Download](https://ffmpeg.org/download.html)

### Required for Whisper Transcription
- **Python** 3.10+ — [Download](https://python.org)
- **faster-whisper** — `pip install faster-whisper`

### Optional (AI-powered notes)
- **Ollama** — [Download](https://ollama.ai)

> Without Ollama, NoteCraft AI uses a built-in extractive note generator that works well for most lectures.

## Configuration

Copy `.env.example` to `.env` and customize:

```
PORT=3000
WHISPER_MODEL=base          # tiny, base, small, medium
OLLAMA_MODEL=qwen2.5        # any Ollama model
OLLAMA_URL=http://127.0.0.1:11434
```

## Architecture

```
NoteCraft AI
├── server.mjs              # Express server
├── backend/
│   ├── youtube.mjs         # URL parsing, metadata
│   ├── transcript.mjs      # Caption retrieval, normalization
│   ├── audio.mjs           # Audio download/conversion
│   ├── whisper.mjs         # Whisper integration (Node)
│   ├── whisper_worker.py   # Whisper transcription (Python)
│   ├── summarizer.mjs      # AI + extractive note generation
│   ├── notes.mjs           # Note storage, validation
│   ├── diagrams.mjs        # Category detection, diagrams
│   ├── jobs.mjs            # Job state machine, SSE
│   ├── system-check.mjs    # Tool detection
│   └── utils.mjs           # Shared utilities
├── public/
│   ├── index.html          # Single-page application
│   ├── styles.css          # UI + notebook renderer
│   └── app.js              # Frontend logic
└── tests/                  # Vitest tests
```

## Processing Pipeline

```
YouTube URL
    ↓
Validate URL → Extract Video ID
    ↓
Fetch Video Info (yt-dlp, 30s timeout)
    ↓
Try Captions (6 strategies, 30s each)
    ├── Found (≥100 chars) → Normalize
    └── Not found → Audio Download (10 min)
                        ↓
                    FFmpeg Convert
                        ↓
                    Whisper (30 min)
                        ↓
                    Normalize Transcript
    ↓
Generate Notes
    ├── Ollama available → AI notes
    └── Ollama unavailable → Extractive notes
    ↓
Generate Diagrams
    ↓
Save + Render Handwritten Pages
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Quick health check |
| GET | `/api/system-check` | Detailed system check |
| POST | `/api/jobs` | Create processing job |
| GET | `/api/jobs/:id` | Get job status |
| GET | `/api/jobs/:id/events` | SSE event stream |
| POST | `/api/jobs/:id/cancel` | Cancel a job |
| GET | `/api/notes/:id` | Get saved notes |
| GET | `/api/history` | List note history |
| DELETE | `/api/history/:id` | Delete history entry |

## Testing

```bash
npm test
```

## License

MIT
