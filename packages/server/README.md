# Voice Assistant

A voice-controlled terminal assistant that runs as a single local service.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env and add your API keys (OpenAI, Deepgram)

# Run development servers
npm run dev

# Open browser to http://localhost:5173
```

## Architecture

- **Express Server** (port 3000) - Serves API and built UI in production
- **Vite Dev Server** (port 5173) - Hot-reload React UI in development
- **WebSocket** (`/ws`) - Real-time bidirectional communication
- **Agent** - STT → LLM → TTS pipeline with terminal control
- **Daemon** - tmux-based terminal management (in-process)

## Development

```bash
# Run both servers (recommended)
npm run dev

# Or run separately:
npm run dev:server  # Express on port 3000
npm run dev:ui      # Vite on port 5173

# Type checking
npm run typecheck

# Build for production
npm run build

# Start production server
npm start
```

## Project Status

**✅ Completed** (Phases 1-2):

- Package setup and configuration
- Express server with WebSocket
- React UI with Vite
- WebSocket client with ping/pong testing

**⏳ In Progress** (Phase 3):

- Terminal control (tmux integration)

**📋 Planned** (Phases 4-9):

- Local dictation
- UI polish

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for complete details.

## Environment Variables

```bash
BYSPACE_LOCAL_MODELS_DIR=~/.byspace/models/local-speech  # Optional model directory override
BYSPACE_DICTATION_LOCAL_STT_MODEL=                        # Prefer selecting in Host settings
BYSPACE_HOME=~/.byspace        # Runtime state directory (agents/, etc.)
BYSPACE_LISTEN=127.0.0.1:6777  # Listen address (host:port or /path/to/socket)
```

`BYSPACE_HOME` defaults to `~/.byspace` and isolates runtime artifacts like `agents/`. `BYSPACE_LISTEN` controls the daemon listen address. For blue/green testing you can run a parallel server without touching production state:

```bash
BYSPACE_HOME=~/.byspace-blue BYSPACE_LISTEN=127.0.0.1:7777 npm run dev
```

## Tech Stack

- **Server**: Express, TypeScript, ws (WebSocket)
- **Client**: React 18, Vite, TypeScript
- **Terminal**: tmux (via child_process)
- **Local dictation**: sherpa-onnx

## Testing

Currently manual testing via:

1. Start servers: `npm run dev`
2. Open http://localhost:5173
3. Test WebSocket connection (green status indicator)
4. Click "Send Ping" button to test communication

More testing guidance as features are implemented.

## License

MIT
