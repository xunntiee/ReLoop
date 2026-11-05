# Tool Base

Minimal base architecture for a new tool inside this repository. This folder is
intentionally isolated from the root workspace so it can be copied, evolved, or
promoted later without changing the current `pp-reup-video` app.

## Documentation

Project documentation lives in [docs/SUMMARY.md](docs/SUMMARY.md).

## Structure

```txt
tool-base/
├── apps/
│   ├── server/      # Hono API shell with config and sample routes
│   └── web/         # Vite React shell with TanStack Router + Query
├── packages/
│   └── config/      # Shared config schema and server-side loader
├── config.example.json
├── package.json
└── tsconfig.json
```

## Local Commands

Run commands from `tool-base/`:

```bash
bun install
bun run dev
bun run check-types
bun run build
bun run build:release
bun run build:portable
```

These root commands are orchestrated by `turbo` in the same style as the source
repo.

The server sample listens on port `34577`. The web sample listens on port
`34568` and proxies `/api` to the server.

## Config Loading

Server config is loaded by `@tool-base/config/server`:

1. If `SERVER_CONFIG_PATH` is set, load that absolute or relative path.
2. Otherwise load `config.json` from this folder when it exists.
3. Otherwise fall back to `config.example.json`.

`config.json` is ignored by git. Copy the example when a local override is
needed:

```bash
cp config.example.json config.json
```

The sample API exposes the public config at `GET /api/config`.

## Windows Release Build

For an internal handoff build that non-technical teammates can run locally, use
the local web bundle:

```bash
bun run build:release
```

This creates:

- `release/PostToVideo-LocalWeb/`
- `release/PostToVideo-LocalWeb-<label>-<timestamp>.zip`

The bundle includes:

- `OPEN TOOL.cmd`
- `STOP TOOL.cmd`
- `HUONG_DAN_TOOL.txt`
- hidden `_tool-runtime/`

Behavior:

- When `OPEN TOOL.cmd` runs, it starts one local server/runtime on port
  `34577`, serves the built web UI from `web-dist`, and opens the browser at
  `http://127.0.0.1:34577/app`.
- If the tool is already running on port `34577`, opening it again just
  launches the browser.
- If startup fails, logs are written to `%LOCALAPPDATA%\\ToolBase\\logs`.
- Threads login prefers Google Chrome and automatically retries Microsoft Edge
  if Chrome is unavailable or fails to launch cleanly.
- Headless crawl prefers Google Chrome, retries Microsoft Edge when needed,
  and does not bundle Chromium. Install or update Chrome/Edge before using the
  portable build.
- User-specific Threads session, voice API keys, and runtime logs are stored
  per machine outside the repo, so the bundle can be shared without carrying
  personal login state.
- If `vendor/ffmpeg/bin/ffmpeg.exe` and `vendor/ffmpeg/bin/ffprobe.exe` exist,
  they are included in the runtime so teammates do not need to install FFmpeg
  separately.

Teammate flow:

1. Unzip the release package.
2. Double-click `OPEN TOOL.cmd`.
3. Log in to Threads once from the app UI. (Required to crawl data fully).
4. Open `Cai dat` (Settings) to add an FPT Voice or Google Voice API key if
   using AI voice.
5. Use the browser UI at `http://127.0.0.1:34577/app`.

## Web Base

The web app demonstrates:

- TanStack Router file routes for `/app` and `/app/settings`.
- TanStack Query for `GET /api/sample` and `GET /api/config`.
- A typed API client in `apps/web/src/lib/api.ts`.
- Local shadcn-style component files under `apps/web/src/components/ui`.

## Intent

- Keep server, web, and config boundaries explicit.
- Provide only sample routes/components/API calls, without product logic.
- Match the main repo style: Bun workspace, Hono server, Vite React web app,
  TanStack tooling, and TypeScript-first packages.
