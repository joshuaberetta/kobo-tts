export interface Env {
  OPENAI_API_KEY: string;
}

export type KoboVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

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
}

export interface SurveyRow {
  name: string;
  type: string;
  label: string;
  hint: string;
  hasAudio: boolean;
  audioFileUid?: string;
}

export interface KoboFormContent {
  survey: RawSurveyRow[];
  settings: Record<string, unknown>;
  translated: string[];
  translations: (string | null)[];
}

export interface RawSurveyRow {
  name: string;
  type: string;
  label?: (string | null)[];
  hint?: (string | null)[];
  "media::audio"?: (string | null)[];
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
  status: "generated" | "skipped" | "error";
  message?: string;
}
