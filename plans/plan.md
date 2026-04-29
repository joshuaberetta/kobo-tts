# KoboTTS — Cloudflare Workers App Plan

## Overview

A Cloudflare Workers service that:
1. Pulls question labels and hints from a KoboToolbox form
2. Generates audio files via OpenAI TTS (configurable voice)
3. Uploads the audio files to the Kobo project as media assets
4. Patches the XLSForm to reference those audio files in the `media::audio` column

---

## Architecture

```
Browser (UI — served by Worker)
        │  user enters: Kobo token, server, project UID, voice, options
        ▼
Cloudflare Worker (HTTP API + static UI)
        │
        ├─► KoboToolbox API  (read form, upload media, patch form)
        └─► OpenAI TTS API   (generate .mp3 audio per label/hint)
```

Credentials (Kobo token, OpenAI key) are entered by the user in the browser and passed in request headers — they are **never stored server-side**. The Worker itself only needs `OPENAI_API_KEY` as a secret (since the OpenAI key is a backend concern); the Kobo token is forwarded per-request from the UI.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/generate` | Trigger full pipeline for a given Kobo asset UID |
| `GET`  | `/preview`  | Return the list of labels/hints that would be processed (dry run) |

### `POST /generate` request body

```json
{
  "asset_uid": "aXXXXXXXXXXXXX",
  "voice": "alloy",          // OpenAI voice: alloy | echo | fable | onyx | nova | shimmer
  "overwrite": false         // skip questions that already have audio attached
}
```

---

## Pipeline Steps (per `POST /generate`)

### Step 1 — Fetch Form Definition
- `GET /api/v2/assets/{asset_uid}/` → retrieve the form's `content` (XLSForm JSON)
- Parse the `survey` array to extract each row's `name`, `label`, and `hint` fields
- Use the first/default label value only — no multi-language handling

### Step 2 — Generate Audio
- For each unique text string (label + hint), call `POST https://api.openai.com/v1/audio/speech`
  - `model`: `gpt-4o-mini-tts`
  - `voice`: from request body
  - `response_format`: `mp3`
  - `input`: the label or hint text
- Deduplicate: same text used in multiple questions generates only one file
- File naming convention: `{question_name}_audio.mp3`

### Step 3 — Upload Media to Kobo
- `GET https://{server}/api/v2/assets/{asset_uid}/files/?file_type=form_media` → fetch list of existing audio files
- For each file to upload: if a file with the same name (`{question_name}_audio.mp3`) already exists, `DELETE https://{server}/api/v2/assets/{asset_uid}/files/{file_uid}/` first (Kobo requires unique filenames)
- `POST https://{server}/api/v2/assets/{asset_uid}/files/` as `multipart/form-data` with fields:
  - `description`: `"default"`
  - `file_type`: `"form_media"`
  - `metadata`: `{"filename":"{question_name}_audio.mp3"}` (JSON string)
  - `base64Encoded`: `data:audio/mpeg;base64,<base64-encoded mp3>`
- Collect the returned file UID and filename for each uploaded file

### Step 4 — Patch the Form

The form content structure (no-translation case):

```json
{
  "survey": [
    {
      "name": "q_name",
      "type": "text",
      "label": ["What is your name?"],
      "hint":  ["Provide your full name."],
      "media::audio": ["q_name_audio.mp3"]   ← added/updated by this step
    }
  ],
  "settings": {},
  "translated": ["hint", "label", "media::audio"],   ← "media::audio" must be added if not present
  "translations": [null]
}
```

- Clone the full original content object (preserve `settings`, `translations`, `translated` as-is)
- For each survey row being processed, set `"media::audio": ["{question_name}_audio.mp3"]`
- Ensure `"media::audio"` is present in the top-level `translated` array; add it if missing
- Leave all other fields (`settings`, `translations`, unprocessed survey rows) unchanged
- `PATCH https://{server}/api/v2/assets/{asset_uid}/` with `{ "content": { ...updated_content } }`

### Step 5 — Redeploy the Form
- `PATCH https://{server}/api/v2/assets/{asset_uid}/deployment/` with form data `active=true`
- Required for changes to take effect for data collectors

---

## UI

A single-page form served at `GET /` by the Worker (inlined HTML or a static asset via Cloudflare Pages, TBD). No framework — plain HTML + vanilla JS is sufficient given the simplicity.

### Form fields

| Field | Type | Notes |
|-------|------|-------|
| Kobo API token | password input | passed as `Authorization: Token <value>` header |
| Server | select | Global (`kf.kobotoolbox.org`), EU (`eu.kobotoolbox.org`), Other (free text) |
| Project UID | text input | the `asset_uid` |
| Voice | select | alloy, echo, fable, onyx, nova, shimmer |
| TTS model | static | `gpt-4o-mini-tts` (fixed) |
### UI flow

1. User fills in the connection fields (token, server, project UID, voice) and clicks **Load Questions** → calls `GET /preview`, which fetches the form survey and the existing `form_media` file list in parallel.
2. A table is displayed with one row per question:

   | # | Question name | Label | Hint | Audio status |
   |---|---------------|-------|------|--------------|
   | ☑ | q_name | "How old are you?" | "Enter your age" | ✅ has audio / ➕ none |

   - Rows with existing audio are clearly marked (e.g. a green indicator showing the current filename).
   - All rows are selected by default via a header checkbox; individual rows can be toggled.
   - A **Select all / Deselect all** control in the header.

3. User adjusts the selection and clicks **Generate Audio** → calls `POST /generate` with the list of selected question names. Shows a live progress log and a final success/error summary.

---

## File / Module Layout (Cloudflare Workers + TypeScript)

```
src/
  index.ts          — Worker entry point, route dispatch (serves UI + API)
  ui.ts             — Returns the HTML string for the single-page UI
  kobo.ts           — KoboToolbox API client (fetch form, upload file, patch form)
  tts.ts            — OpenAI TTS client (generate audio buffer)
  pipeline.ts       — Orchestrates steps 1–4
  types.ts          — Shared TypeScript types
wrangler.toml       — Cloudflare Worker config
```

---

## Configuration & Secrets

| Name | Where | Notes |
|------|-------|-------|
| `OPENAI_API_KEY` | Worker Secret | OpenAI key — server-side only |
| Kobo token | Request header (`Authorization: Token <value>`) | Entered by user in UI, forwarded as-is to Kobo API, never persisted |
| Kobo server URL | Request body | Selected by user in UI |

---

## Open Questions / Pending Guidance

- **Kobo endpoints**: Need confirmation of exact endpoints for:
  - Fetching form content (survey JSON)
  - Patching form content with updated XLSForm JSON
- **Re-runs / idempotency**: Should existing audio files on Kobo be replaced or skipped by default?
- **Rate limiting**: OpenAI TTS and Kobo uploads — may need sequential processing or a simple retry loop within the Worker's CPU time limit (Cloudflare free tier: 10ms CPU; paid: no hard limit).

---

## Out of Scope (for now)

- Storing generated audio independently of Kobo
- Support for non-OpenAI TTS providers (architected to be swappable via `tts.ts`)
