# KoboTTS — Multi-Language Support Plan

## Overview

Extend the pipeline to generate one audio file per translation per question when a form has multiple languages, naming files `{question_name}_audio_{iso}.mp3`. Single-language forms (no translations or `translations: [null]`) keep the existing `{question_name}_audio.mp3` convention unchanged.

---

## Translation structure in Kobo

The `translations` array is the source of truth for language ordering. Each entry is either:

- `null` — no multilingual support (single-language form)
- `"English (en)"` — a human-readable label with the ISO 639-1 code in parentheses at the end

Every translatable field (`label`, `hint`, `media::audio`) is an array indexed **in parallel** with `translations`. So `label[0]` is the first language, `label[1]` is the second, etc.

```json
{
  "translations": ["English (en)", "Spanish (es)"],
  "survey": [
    {
      "label": ["What is your name?", "¿Cual es tu nombre?"],
      "hint":  ["Provide your full name.", "Ingresa su nombre completo."],
      "media::audio": ["name_audio_en.mp3", "name_audio_es.mp3"]
    }
  ]
}
```

### Extracting the ISO code

Parse with a regex on each `translations` entry:

```
/\(([a-z]{2,3})\)$/i  →  "English (en)" → "en"
```

If no match (e.g. `null` or a malformed string), treat as single-language.

---

## Determining single-language vs multi-language

A form is **single-language** if `translations` is `[null]` or empty. It is **multi-language** if any entry in `translations` is a non-null string.

| Condition | Filename pattern | `media::audio` array length |
|-----------|-----------------|----------------------------|
| `translations: [null]` | `{name}_audio.mp3` | 1 |
| `translations: ["English (en)", "Spanish (es)"]` | `{name}_audio_en.mp3`, `{name}_audio_es.mp3` | 2 (one per language) |

---

## Type changes (`src/types.ts`)

### New: `LanguageEntry`

```typescript
export interface LanguageEntry {
  iso: string;          // "en", "es"
  label: string;        // label text for this language
  hint: string;         // hint text for this language
  hasAudio: boolean;
  audioFileUid?: string;
}
```

### Updated: `SurveyRow`

Replace the flat `label`, `hint`, `hasAudio`, `audioFileUid` fields with a `languages` array:

```typescript
export interface SurveyRow {
  name: string;
  type: string;
  languages: LanguageEntry[];   // one entry per translation; length === 1 for single-language
}
```

Single-language rows will have `languages` with one entry where `iso === ""` (empty string — no suffix needed).

---

## `parseSurveyRows` changes (`src/kobo.ts`)

1. Detect single vs multi-language:
   ```typescript
   const isoList = content.translations
     .map(t => (typeof t === 'string' ? (t.match(/\(([a-z]{2,3})\)$/i)?.[1] ?? '') : ''));
   // e.g. ["en", "es"] or [""] for single-language
   ```

2. For each survey row, build `languages` by iterating `isoList`:
   ```typescript
   languages: isoList.map((iso, i) => {
     const expectedFilename = iso
       ? `${row.name}_audio_${iso}.mp3`
       : `${row.name}_audio.mp3`;
     const audioUid = audioMap.get(expectedFilename);
     return {
       iso,
       label: row.label?.[i] ?? '',
       hint: row.hint?.[i] ?? '',
       hasAudio: audioUid !== undefined,
       audioFileUid: audioUid,
     };
   })
   ```

3. Remove the old flat `label`, `hint`, `hasAudio`, `audioFileUid` from the return type.

---

## Pipeline changes (`src/pipeline.ts`)

### `generate` loop

For each target row, iterate over `row.languages` instead of treating label/hint as a single string:

```typescript
for (const lang of row.languages) {
  const text = [lang.label, lang.hint].filter(Boolean).join('. ');
  if (!text.trim()) { /* yield skipped */ continue; }

  const filename = lang.iso
    ? `${row.name}_audio_${lang.iso}.mp3`
    : `${row.name}_audio.mp3`;

  const mp3 = await generateAudio(text, voice, openAiApiKey);

  if (lang.hasAudio && lang.audioFileUid) {
    await deleteMediaFile(serverUrl, assetUid, lang.audioFileUid, koboToken);
  }
  await uploadMediaFile(serverUrl, assetUid, koboToken, filename, mp3);
}
```

### Patching `media::audio`

The field must be an array indexed parallel to `translations`. Build it by mapping `isoList`:

```typescript
surveyRow['media::audio'] = isoList.map(iso =>
  iso ? `${row.name}_audio_${iso}.mp3` : `${row.name}_audio.mp3`
);
```

### `GenerateResult` — consider per-language granularity

Optionally extend to carry the language iso in the result for richer UI feedback:

```typescript
export interface GenerateResult {
  question: string;
  iso?: string;          // present if multi-language
  status: 'generated' | 'skipped' | 'error';
  message?: string;
}
```

---

## UI changes (`src/ui.ts`)

### Preview table

- The **Audio** column becomes a list of language badges, one per `LanguageEntry`:
  - `EN ✓` (green) / `EN —` (grey) for each ISO code
- For single-language rows, render a single badge with no ISO label (same as today).

### Log output

When multi-language, log lines include the ISO code:

```
✅ name (en)
✅ name (es)
```

For single-language forms, keep the existing format:

```
✅ name
```

### Badge update on success

When an SSE event carries `{ question, iso, status: 'generated' }`, mark only the matching language badge green in the table — not all languages.

---

## Backward compatibility

- Single-language forms (`translations: [null]`): `isoList = [""]`, `iso === ""` → filename `{name}_audio.mp3`. No change to filenames, no change to the `media::audio` array structure. Fully compatible.
- No schema migration needed on existing Kobo forms.

---

## Files to change

| File | Change |
|------|--------|
| `src/types.ts` | Add `LanguageEntry`; update `SurveyRow`; add `iso?` to `GenerateResult` |
| `src/kobo.ts` | Update `parseSurveyRows` to build `languages[]` from `translations` |
| `src/pipeline.ts` | Inner loop iterates `row.languages`; filename uses `iso`; `media::audio` set as parallel array |
| `src/ui.ts` | Audio column shows per-language badges; log lines include ISO; badge update targets specific language |
