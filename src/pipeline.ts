import {
  fetchFormContent,
  listMediaFiles,
  deleteMediaFile,
  uploadMediaFile,
  patchFormContent,
  redeployForm,
  parseSurveyRows,
} from "./kobo";
import { generateAudio } from "./tts";
import type { GenerateRequest, GenerateResult, KoboFormContent, SurveyRow } from "./types";

export async function preview(
  serverUrl: string,
  assetUid: string,
  koboToken: string
): Promise<SurveyRow[]> {
  const [{ content }, mediaFiles] = await Promise.all([
    fetchFormContent(serverUrl, assetUid, koboToken),
    listMediaFiles(serverUrl, assetUid, koboToken),
  ]);
  return parseSurveyRows(content, mediaFiles);
}

export async function* generate(
  req: GenerateRequest,
  openAiApiKey: string
): AsyncGenerator<GenerateResult> {
  const { koboToken, serverUrl, assetUid, voice, questionNames } = req;

  const [{ content }, mediaFiles] = await Promise.all([
    fetchFormContent(serverUrl, assetUid, koboToken),
    listMediaFiles(serverUrl, assetUid, koboToken),
  ]);

  const rows = parseSurveyRows(content, mediaFiles);
  const targetSet = new Set(questionNames.length > 0 ? questionNames : rows.map((r) => r.name));
  const targets = rows.filter((r) => targetSet.has(r.name));

  const updatedContent: KoboFormContent = {
    ...content,
    survey: content.survey.map((row) => ({ ...row })),
    translated: [...content.translated],
  };

  for (const row of targets) {
    const text = [row.label, row.hint].filter(Boolean).join(". ");
    if (!text.trim()) {
      yield { question: row.name, status: "skipped", message: "no label or hint text" };
      continue;
    }

    try {
      // Step 2: generate audio
      const mp3 = await generateAudio(text, voice, openAiApiKey);

      // Step 3: delete existing file if present, then upload
      const filename = `${row.name}_audio.mp3`;
      if (row.hasAudio && row.audioFileUid) {
        await deleteMediaFile(serverUrl, assetUid, row.audioFileUid, koboToken);
      }
      await uploadMediaFile(serverUrl, assetUid, koboToken, filename, mp3);

      // Step 4: update the survey row in the cloned content
      const surveyRow = updatedContent.survey.find((s) => s.name === row.name);
      if (surveyRow) {
        surveyRow["media::audio"] = [filename];
      }
      if (!updatedContent.translated.includes("media::audio")) {
        updatedContent.translated.push("media::audio");
      }

      yield { question: row.name, status: "generated" };
    } catch (err) {
      yield {
        question: row.name,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Step 4: patch form with all updates at once; returns the new version_id
  const newVersionId = await patchFormContent(serverUrl, assetUid, koboToken, updatedContent);

  // Step 5: redeploy using the version_id from the patch response
  await redeployForm(serverUrl, assetUid, koboToken, newVersionId);
}
