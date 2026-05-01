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
  const audioRows = rows.filter((r) => !r.isGroup);
  const targetSet = new Set(questionNames.length > 0 ? questionNames : audioRows.map((r) => r.name));
  const targets = audioRows.filter((r) => targetSet.has(r.name));

  const updatedContent: KoboFormContent = {
    ...content,
    survey: content.survey.map((row) => ({ ...row })),
    translated: [...content.translated],
  };

  // Build isoList once — same logic as parseSurveyRows
  const isoList = audioRows[0]?.languages.map((l) => l.iso) ?? [""];

  for (const row of targets) {
    let anyGenerated = false;

    for (const lang of row.languages) {
      const text = [lang.label, lang.hint].filter(Boolean).join(". ");
      if (!text.trim()) {
        yield { question: row.name, iso: lang.iso || undefined, status: "skipped", message: "no label or hint text" };
        continue;
      }

      try {
        const mp3 = await generateAudio(text, voice, openAiApiKey);

        const filename = lang.iso
          ? `${row.name}_audio_${lang.iso}.mp3`
          : `${row.name}_audio.mp3`;

        if (lang.hasAudio && lang.audioFileUid) {
          await deleteMediaFile(serverUrl, assetUid, lang.audioFileUid, koboToken);
        }
        await uploadMediaFile(serverUrl, assetUid, koboToken, filename, mp3);

        anyGenerated = true;
        yield { question: row.name, iso: lang.iso || undefined, status: "generated" };
      } catch (err) {
        yield {
          question: row.name,
          iso: lang.iso || undefined,
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (anyGenerated) {
      // Update media::audio as a parallel array matching isoList
      const surveyRow = updatedContent.survey.find((s) => s.name === row.name);
      if (surveyRow) {
        surveyRow["media::audio"] = isoList.map((iso) =>
          iso ? `${row.name}_audio_${iso}.mp3` : `${row.name}_audio.mp3`
        );
      }
      if (!updatedContent.translated.includes("media::audio")) {
        updatedContent.translated.push("media::audio");
      }
    }
  }

  const newVersionId = await patchFormContent(serverUrl, assetUid, koboToken, updatedContent);

  if (req.redeploy) {
    await redeployForm(serverUrl, assetUid, koboToken, newVersionId);
  }
}
