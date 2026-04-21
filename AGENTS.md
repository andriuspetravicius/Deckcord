# Deckcord

## Stack
- TypeScript 5.6, React 19 type definitions, Decky plugin runtime
- Python 3 backend (aiohttp)

## Commands
- Build frontend: `pnpm run build`
- Type check: `pnpm exec tsc --noEmit --skipLibCheck`
- Python syntax check: `python3 -m compileall -q main.py defaults`

## Architecture
- Frontend plugin entry: `src/index.tsx`
- Injected Discord client/runtime bridge: `defaults/deckcord_client.js`
- Backend entrypoint: `main.py`
- Event/state bridge: `defaults/discord_client/event_handler.py`

## Learned Rules
- For concurrent request maps, always capture a per-call request ID and clean up by that exact ID, never by mutable global counters.
- Never embed raw JSON/user-controlled text in quoted JS snippets for `Runtime.evaluate`; pass JSON objects directly.
- For filesystem authorization, never use `startswith` path checks; use `os.path.commonpath` with real paths.
- Any listener/callback added to global or host-managed callback arrays must have explicit unload cleanup.
