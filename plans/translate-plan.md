# KoboTTS — Form Translation Plan

## Overview

Add a **Translate** flow alongside the existing **Generate Audio** flow. The user selects a target language, optionally provides translation instructions, and the app calls an LLM to translate every translatable text field in the form. The result is patched back to Kobo and redeployed — exactly like the audio flow. After translation, the user can immediately proceed to Generate Audio for the new language.

---

## What gets translated

The source of truth is `content.translated[]` — the array Kobo uses to declare which fields are translatable. The app translates exactly the fields listed there, for both `survey` rows and `choices` rows. Common values are `"label"`, `"hint"`, `"constraint_message"`, `"required_message"`, `"media::audio"` (skipped — handled by the audio flow).

All row types with text in those fields are included: questions, `begin_group`, `end_group`, `begin_repeat`, `end_repeat`, `note`.

`select_one` / `select_multiple` rows carry a `select_from_list_name` field pointing to a list in `content.choices[]`. Those choice rows have their own `label` arrays (and any other fields in `translated`) — these must also be translated.

Fields that are **never** translated regardless of `translated[]`: `name`, `type`, `constraint` (XPath), `relevant` (XPath), `required`, `appearance`, `calculation`, `default`, `repeat_count`, `media::audio` (audio pipeline's concern).

---

## Kobo content structure

```json
{
  "survey": [
    {
      "name": "people",
      "type": "begin_group",
      "label": ["People"]
    },
    {
      "name": "age",
      "type": "integer",
      "label": ["How old are you?"],
      "hint":  ["Enter your age in years."]
    },
    {
      "name": "colour",
      "type": "select_one",
      "label": ["Select a colour."],
      "select_from_list_name": "colours"
    },
    { "type": "end_group" }
  ],
  "choices": [
    { "list_name": "colours", "name": "red",   "label": ["Red"] },
    { "list_name": "colours", "name": "green", "label": ["Green"] },
    { "list_name": "colours", "name": "blue",  "label": ["Blue"] }
  ],
  "translations": ["English (en)"],
  "translated": ["label", "hint"]
}
```

After adding a Spanish translation the arrays grow to length 2, indexed in parallel with `translations`:

```json
{
  "translations": ["English (en)", "Spanish (es)"],
  "survey": [
    {
      "label": ["How old are you?", "¿Cuántos años tienes?"],
      "hint":  ["Enter your age in years.", "Ingresa tu edad en años."]
    }
  ],
  "choices": [
    { "list_name": "gender_list", "name": "male", "label": ["Male", "Hombre"] }
  ]
}
```

---

## Translation target language format

The `translations` entry format is `"Language Name (iso)"`, e.g. `"Spanish (es)"`. When adding a new language the app must:

1. Check whether the target ISO code already exists in `translations`.
   - **Exists**: overwrite that index (re-translate).
   - **New**: append to `translations` and extend every translated array in `survey` and `choices` by one slot.

---

## LLM translation approach

Use the OpenAI Chat Completions API (`gpt-4o` or `gpt-4o-mini` — configurable). Translate **all fields for one survey row in a single API call** to keep costs down and preserve cross-field coherence (label and hint for the same question go together).

### Batch strategy

Group items to translate into batches by row. Each batch call sends a JSON payload of strings and receives back translated strings at the same indices:

```
Input:  { label: "How old are you?", hint: "Enter your age." }
Output: { label: "¿Cuántos años tienes?", hint: "Ingresa tu edad." }
```

Choices are batched separately — one call per `list_name` (all options for a list in one request).

### System prompt

```
You are a professional form translator. Translate the given survey form text from {sourceLang} into {targetLang}.
Preserve the meaning and tone exactly. Do not add or remove information.
Return only the translated text — no explanations, no extra punctuation.

Additional instructions:
{userInstructions}
```

The `userInstructions` field is omitted from the prompt if blank.

### Source language

Infer from `translations[0]` (the first/base language). If `translations` is `[null]` or the first entry has no recognisable language name, fall back to `"the source language"` in the prompt.

---

## New types (`src/types.ts`)

```typescript
export interface TranslateRequest {
  koboToken: string;
  serverUrl: string;
  assetUid: string;
  targetIso: string;        // e.g. "es"
  targetLangLabel: string;  // e.g. "Spanish (es)" — written into translations[]
  instructions: string;     // free-text additional instructions; may be empty
  questionNames: string[];  // subset to translate; empty = all
}

export interface TranslateResult {
  item: string;       // question name or "choices:{list_name}"
  status: "translated" | "skipped" | "error";
  message?: string;
}
```

---

## New module: `src/translate.ts`

```typescript
export async function* translate(
  req: TranslateRequest,
  openAiApiKey: string
): AsyncGenerator<TranslateResult>
```

### Steps

1. `fetchFormContent` → get `content` and `versionId`.
2. Determine `targetIndex`:
   - Search `content.translations` for an entry matching `targetIso`.
   - If found: `targetIndex = i` (overwrite mode).
   - If not found: `targetIndex = content.translations.length` (append mode).
3. Clone content, extend arrays if appending:
   - For every survey row with translated fields, push `null` at `targetIndex`.
   - For every choice row, push `null` at `targetIndex`.
   - If appending: push `targetLangLabel` onto `translations`.
   - Ensure all fields in `translated` that exist in the data are listed.
4. Determine the set of translatable field names: `content.translated` minus `"media::audio"`.
5. For each target survey row (filtered by `questionNames` if provided):
   - Collect non-empty values for each translatable field from index `sourceIndex` (index 0).
   - If none: yield `{ item: row.name, status: "skipped" }`.
   - Call LLM with the batch (`{ label: "...", hint: "..." }` etc.).
   - Write translated values into the cloned content at `targetIndex`.
   - yield `{ item: row.name, status: "translated" }`.
6. For each unique `list_name` referenced via `select_from_list_name` on target rows:
   - Collect translatable field values for all choices in that list.
   - Call LLM with the batch (all choices together, keyed by `"{name}.{field}"`).
   - Write translated values into cloned choices at `targetIndex`.
   - yield `{ item: "choices:{list_name}", status: "translated" }`.
6. `patchFormContent` → get `newVersionId`.
7. `redeployForm(... newVersionId)`.

---

## New module: `src/llm.ts`

```typescript
export async function translateFields(
  fields: Record<string, string>,   // { label: "...", hint: "..." }
  sourceLang: string,
  targetLang: string,
  instructions: string,
  openAiApiKey: string
): Promise<Record<string, string>>
```

- Uses `POST https://api.openai.com/v1/chat/completions`.
- Model: `gpt-4o-mini` (cheap, fast; sufficient for translation).
- Sends fields as a JSON object in the user message; expects a JSON object back.
- Parses the response with `JSON.parse`; throws on malformed output.

---

## Route

Add to `src/index.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/translate` | Translate form fields, stream SSE results |

Request body shape matches `TranslateRequest`. Response is SSE, same envelope as `/generate`.

---

## UI changes (`src/ui.ts`)

### New tab / section: "Translate"

Add a second top-level section (or a tab switcher) below the connection card:

**Translate tab**

| Control | Notes |
|---------|-------|
| Target language | `Select` — common languages prepopulated (English, Spanish, French, Arabic, Swahili, Portuguese, Hindi…) plus "Other…" with free-text ISO input |
| Additional instructions | `Textarea` — e.g. "Use simple language suitable for low-literacy respondents. Use the tú form in Spanish." Optional. |
| Load Questions button | Reuses the same `/preview` call; shows the same question table |
| Question selection | Same checkbox table as audio flow |
| **Translate Form** button | Calls `POST /translate`, streams SSE log |

**Generate Audio tab** (existing flow, unchanged)

### Tab switcher

Two pills/tabs at the top of the questions card: **Generate Audio** | **Translate Form**. Switching tabs shows the relevant action button and log; the question table and selection state are shared.

### Post-translation flow

After translation completes successfully, show an inline prompt:
> "Translation complete. Generate audio for the new language?"
> [Yes, generate audio] button — pre-selects the translated questions and switches to the Generate Audio tab with the target ISO preselected as the voice language filter (if applicable).

### SSE log for translation

Same dark log panel. Each line:
```
✅ age               — translated
✅ choices:gender_list — translated
⏭ note_intro        — skipped (no text)
❌ q_open            — error: LLM returned invalid JSON
```

---

## Files to create / modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `TranslateRequest`, `TranslateResult` |
| `src/llm.ts` | **New** — LLM chat completions client for translation |
| `src/translate.ts` | **New** — translation pipeline (mirrors pipeline.ts structure) |
| `src/index.ts` | Add `POST /translate` route |
| `src/kobo.ts` | No changes needed |
| `src/pipeline.ts` | No changes needed |
| `src/ui.ts` | Add Translate tab, target language select, instructions textarea, Translate button, post-translation prompt |

---

## Out of scope (for now)

- Translation memory / deduplication across identical strings in different questions
- Diff view showing source vs translated text before committing
- Rollback / undo translation
- Non-OpenAI translation providers
