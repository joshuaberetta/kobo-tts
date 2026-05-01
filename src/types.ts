export interface Env {
  OPENAI_API_KEY: string;
}

export type KoboVoice = "alloy" | "ash" | "ballad" | "cedar" | "coral" | "echo" | "fable" | "marin" | "nova" | "onyx" | "sage" | "shimmer";

export interface PreviewRequest {
  koboToken: string;
  serverUrl: string;
  assetUid: string;
}

export interface GenerateRequest {
  koboToken: string;
  serverUrl: string;
  assetUid: string;
  voice: KoboVoice;
  questionNames: string[]; // subset selected in UI; empty = all
  redeploy: boolean;
}

export interface LanguageEntry {
  iso: string;        // e.g. "en", "es"; "" for single-language forms
  label: string;
  hint: string;
  hasAudio: boolean;
  audioFileUid?: string;
}

export interface ChoiceEntry {
  name: string;
  labels: { iso: string; label: string }[];
}

export interface SurveyRow {
  name: string;
  type: string;
  languages: LanguageEntry[];
  choices?: ChoiceEntry[];  // present for select_one / select_multiple rows
  isGroup?: boolean;        // true for begin_group / begin_repeat rows
}

export interface KoboFormContent {
  survey: RawSurveyRow[];
  choices?: RawChoice[];
  settings: Record<string, unknown>;
  translated: string[];
  translations: (string | null)[];
}

export interface RawSurveyRow {
  name?: string;
  type: string;
  label?: (string | null)[];
  hint?: (string | null)[];
  "media::audio"?: (string | null)[];
  select_from_list_name?: string;
  [key: string]: unknown;
}

export interface RawChoice {
  list_name: string;
  name: string;
  label?: (string | null)[];
  [key: string]: unknown;
}

export interface KoboMediaFile {
  uid: string;
  metadata: { filename: string };
}

export interface KoboMediaListResponse {
  results: KoboMediaFile[];
}

export interface GenerateResult {
  question: string;
  iso?: string;
  status: "generated" | "skipped" | "error";
  message?: string;
}

export interface TranslateRequest {
  koboToken: string;
  serverUrl: string;
  assetUid: string;
  targetIso: string;        // e.g. "es"
  targetLangLabel: string;  // e.g. "Spanish (es)" — written into translations[]
  instructions: string;
  questionNames: string[];  // empty = all
  redeploy: boolean;
}

export interface TranslateResult {
  item: string;  // question name or "choices:{list_name}"
  status: "translated" | "skipped" | "error";
  message?: string;
}
