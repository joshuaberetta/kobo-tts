import type {
  KoboFormContent,
  KoboMediaFile,
  KoboMediaListResponse,
  RawSurveyRow,
  SurveyRow,
} from "./types";

function headers(token: string): HeadersInit {
  return { Authorization: `Token ${token}` };
}

export async function fetchFormContent(
  serverUrl: string,
  assetUid: string,
  token: string
): Promise<{ content: KoboFormContent; versionId: string }> {
  const res = await fetch(`${serverUrl}/api/v2/assets/${assetUid}/`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Kobo fetchForm ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: KoboFormContent; version_id: string };
  return { content: data.content, versionId: data.version_id };
}

export async function listMediaFiles(
  serverUrl: string,
  assetUid: string,
  token: string
): Promise<KoboMediaFile[]> {
  const res = await fetch(
    `${serverUrl}/api/v2/assets/${assetUid}/files/?file_type=form_media`,
    { headers: headers(token) }
  );
  if (!res.ok) throw new Error(`Kobo listMedia ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as KoboMediaListResponse;
  return data.results;
}

export async function deleteMediaFile(
  serverUrl: string,
  assetUid: string,
  fileUid: string,
  token: string
): Promise<void> {
  const res = await fetch(
    `${serverUrl}/api/v2/assets/${assetUid}/files/${fileUid}/`,
    { method: "DELETE", headers: headers(token) }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Kobo deleteMedia ${res.status}: ${await res.text()}`);
  }
}

export async function uploadMediaFile(
  serverUrl: string,
  assetUid: string,
  token: string,
  filename: string,
  mp3Buffer: ArrayBuffer
): Promise<void> {
  const base64 = bufferToBase64(mp3Buffer);
  const body = new FormData();
  body.append("description", "default");
  body.append("file_type", "form_media");
  body.append("metadata", JSON.stringify({ filename }));
  body.append("base64Encoded", `data:audio/mpeg;base64,${base64}`);

  const res = await fetch(`${serverUrl}/api/v2/assets/${assetUid}/files/`, {
    method: "POST",
    headers: headers(token),
    body,
  });
  if (!res.ok) throw new Error(`Kobo uploadMedia ${res.status}: ${await res.text()}`);
}

export async function patchFormContent(
  serverUrl: string,
  assetUid: string,
  token: string,
  content: KoboFormContent
): Promise<string> {
  const res = await fetch(`${serverUrl}/api/v2/assets/${assetUid}/`, {
    method: "PATCH",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Kobo patchForm ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { version_id: string };
  return data.version_id;
}

export async function redeployForm(
  serverUrl: string,
  assetUid: string,
  token: string,
  versionId: string
): Promise<void> {
  const body = new FormData();
  body.append("active", "true");
  body.append("version_id", versionId);
  const res = await fetch(`${serverUrl}/api/v2/assets/${assetUid}/deployment/`, {
    method: "PATCH",
    headers: headers(token),
    body,
  });
  if (!res.ok) throw new Error(`Kobo redeploy ${res.status}: ${await res.text()}`);
}

export function parseSurveyRows(
  content: KoboFormContent,
  mediaFiles: KoboMediaFile[]
): SurveyRow[] {
  const audioMap = new Map<string, string>(); // filename → uid
  for (const f of mediaFiles) {
    audioMap.set(f.metadata.filename, f.uid);
  }

  const skippedTypes = new Set(["begin_group", "end_group", "begin_repeat", "end_repeat", "note"]);

  return content.survey
    .filter((row: RawSurveyRow) => !skippedTypes.has(row.type))
    .map((row: RawSurveyRow): SurveyRow => {
      const expectedFilename = `${row.name}_audio.mp3`;
      const audioUid = audioMap.get(expectedFilename);
      return {
        name: row.name,
        type: row.type,
        label: row.label?.[0] ?? "",
        hint: row.hint?.[0] ?? "",
        hasAudio: audioUid !== undefined,
        audioFileUid: audioUid,
      };
    });
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
