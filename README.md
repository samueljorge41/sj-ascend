# Base44 Project

Use this repository to run and edit the app locally, then publish changes back through Base44.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.

See the [Base44 CLI docs](https://docs.base44.com/developers/references/cli/get-started/overview) if you want to run Base44 commands directly.

## Run Locally

Run the full local development environment from the project root:

```bash
base44 dev
```

`base44 dev` starts the local Base44 development backend and, when this app is configured for it, also starts the frontend dev server for you. Use the frontend URL printed by the command.

For example, when the Base44 project config includes a `serveCommand`, `base44 dev` can launch the frontend too:

```json5
{
  "site": {
    "serveCommand": "npm run dev"
  }
}
```

In a Base44 project this lives in `base44/config.jsonc`.

## Run Only The Frontend

If you only want to work on the frontend against the hosted Base44 backend, run:

```bash
npm run dev
```

Open the local URL printed by Vite.

## Use The Hosted Backend

For frontend-only development, create or update `.env.local` in the project root:

```bash
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=https://your-app.base44.app
```

`VITE_BASE44_APP_ID` identifies the Base44 app.

`VITE_BASE44_APP_BASE_URL` tells the Base44 Vite plugin where to send local `/api` requests. Point it at your deployed Base44 app URL when you want the local frontend to use the hosted backend.

When you use `base44 dev`, the command injects the local Base44 values for you, so `.env.local` is mainly needed for frontend-only workflows.

## WhatsApp integration

The WhatsApp tab does not add another SJ login or access screen. On `localhost`, its backend requests use the local Express service without depending on Base44; the only additional authentication is linking WhatsApp with the QR Code shown in the tab. Non-local backends still validate the existing SJ/Base44 session.

For local development, Express accepts WhatsApp requests only over loopback (`localhost` / `127.0.0.1`) and creates a persistent encryption key at `server/.whatsapp-session-key` automatically. Keep that ignored file with the local SQLite database so a restart can recover the linked WhatsApp session.

For a deployed or otherwise non-local backend, configure these values in `server/.env` (copy the names from `server/.env.example`):

- `BASE44_APP_BASE_URL`: the same Base44 app URL used by the frontend.
- `BASE44_APP_ID`: the app ID used by the frontend.
- `WHATSAPP_SESSION_KEY`: a persistent 32-byte key encoded as Base64. Generate it once with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and keep it in the backend secret store. Do not regenerate it after linking a WhatsApp account: the saved credentials are encrypted with this key.

The service stores encrypted WhatsApp credentials and Signal keys in the SQLite database at `DATABASE_PATH` (by default `server/database/data/app.sqlite`). Keep that database on persistent storage and back up the session key separately. Chat names and message text are also stored in SQLite to provide conversation history. Run one Express backend instance for this single linked WhatsApp session; do not scale it to multiple replicas without adding shared session locking and storage.

For local use, run the Express service and Vite frontend together with `npm run dev:all`. The app itself runs locally, while Baileys still needs internet access to WhatsApp. It is an unofficial WhatsApp Web integration, so it can require a fresh QR scan after WhatsApp revokes a linked device or changes its web protocol.

## Google Calendar integration

For Google Calendar synchronization, configure the official Google Calendar API integration in the backend environment. Enable the Google Calendar API in Google Cloud, create an OAuth 2.0 **Web application** client, and add the exact `GOOGLE_CALENDAR_REDIRECT_URI` as an authorized redirect URI. For local development, the default is `http://localhost:3001/api/agenda/google-auth/callback`; register that exact URL in Google Cloud. The OAuth consent screen must allow the Google account that owns or can edit the target calendar. The app requests `calendar.events` to create, edit, and delete synchronized events, plus `calendar.calendarlist.readonly` to read Google's event color palette.

Set these backend-only values from `server/.env.example`:

- `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`: OAuth web client credentials. Never expose the secret in frontend variables or commit it.
- `GOOGLE_CALENDAR_REDIRECT_URI`: public HTTPS callback, exactly `/api/agenda/google-auth/callback` on the Express backend.
- `GOOGLE_CALENDAR_WEBHOOK_URL`: optional public HTTPS endpoint `/api/agenda/google-webhook`. When configured, Google push notifications can refresh open tabs faster. It cannot be localhost; Google must reach it directly with a valid TLS certificate.
- `GOOGLE_CALENDAR_RETURN_URL`: optional frontend Agenda URL; defaults to `http://localhost:5173/agenda` for local work or `BASE44_APP_BASE_URL/agenda` when deployed.
- `GOOGLE_CALENDAR_ID`: calendar ID (defaults to `primary`; use the ID of another calendar if appropriate).
- `GOOGLE_CALENDAR_TOKEN_KEY`: persistent 32-byte Base64 key used to encrypt OAuth tokens in SQLite. Generate once with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, store it in the backend secret manager, and do not rotate it without re-encrypting the saved token.

Run the local frontend and Express backend, open Agenda, and select **Conectar Google**. If the account was previously connected without write access, select **Autorizar escrita**. If Google reports that its token expired or was revoked, select **Reconectar Google** and complete authorization again. To match custom event colors, select **Atualizar cores Google** and approve the read-only calendar-list permission. Google event marker IDs can be mapped to app colors; marker names and colors are not provided as a mapping by the Calendar API. Events without an explicit mapped marker or `colorId` retain the app's default color. The **Subido PRO** eye button shows or hides the read-only public iCal calendar; its feed URL is configured with `SUBIDO_PRO_CALENDAR_ICAL_URL` and defaults to the public feed supplied for this calendar. Its events are displayed in blue and cannot be edited or deleted from this app. Left-click a card to view its quick details, Meet link when available, edit, or delete; right-click to choose a Google Calendar color. Linked system events keep that color synchronized with Google. The **Lista** side panel is a freeform planning scratchpad: entries are saved automatically by the local Express backend to `agenda-planning-draft.json` beside the SQLite database (by default, `server/database/data/agenda-planning-draft.json`) and can be dragged onto a time slot to create an appointment. The panel resizes the calendar instead of covering it. Clicking an empty time slot opens a compact event form, with **Mais opções** for the full form. Dragging or resizing a card updates its displayed position immediately while the change is saved; if saving fails, the card returns to its previous position and an error is shown. Deletions can be undone for a few seconds before they are committed. The backend syncs agenda items, client demands, and prospect next actions with Google every 30 seconds, including while the Agenda tab is closed. Events without a time are created as all-day events. Deleting a synchronized Google event hides it from the SJ Ascend Agenda while preserving its client or prospect record. Google changes may take up to 30 seconds to appear; this is not a hard latency guarantee. The calendar grid renders while data loads, and the current date range is cached in the browser session for five minutes so returning to Agenda can show its cards immediately while refreshing in the background. Only one range is cached; loading another range replaces the prior cache.

The Google Calendar API is also polled for changes every 30 seconds; an optional public HTTPS webhook can notify open tabs faster. It cannot be localhost; Google must reach it directly with a valid TLS certificate.

`GOOGLE_CALENDAR_ICAL_URL` remains an optional read-only fallback for deployments not yet configured for OAuth. Google controls the freshness of that feed, so it cannot provide reliable real-time notifications. Keep its secret URL in the backend environment only.

## Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

## Docs & Support

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Base44 CLI command reference: [https://docs.base44.com/developers/references/cli/commands/introduction](https://docs.base44.com/developers/references/cli/commands/introduction)

Support: [https://app.base44.com/support](https://app.base44.com/support)
