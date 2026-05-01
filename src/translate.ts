import { fetchFormContent, patchFormContent, redeployForm } from "./kobo";
import { translateFields } from "./llm";
import type { KoboFormContent, TranslateRequest, TranslateResult } from "./types";

const NEVER_TRANSLATE = new Set(["media::audio"]);

function extractIso(translationLabel: string | null): string {
  if (typeof translationLabel !== "string") return "";
  return translationLabel.match(/\(([a-z]{2,3})\)$/i)?.[1] ?? "";
}

function sourceLangName(content: KoboFormContent): string {
  const first = content.translations[0];
  return typeof first === "string" ? first : "the source language";
}

export async function* translate(
  req: TranslateRequest,
  openAiApiKey: string
): AsyncGenerator<TranslateResult> {
  const { koboToken, serverUrl, assetUid, targetIso, targetLangLabel, instructions, questionNames } = req;

  const { content } = await fetchFormContent(serverUrl, assetUid, koboToken);

  // Determine target index (overwrite existing or append new)
  let targetIndex = content.translations.findIndex(
    (t) => extractIso(t) === targetIso
  );
  const isAppend = targetIndex === -1;
  if (isAppend) targetIndex = content.translations.length;

  // Fields to translate: everything in translated[] except those we never touch
  const translatableFields = content.translated.filter((f) => !NEVER_TRANSLATE.has(f));

  const sourceLang = sourceLangName(content);
  const targetLang = targetLangLabel;

  // Deep-clone content
  const updatedContent: KoboFormContent = {
    ...content,
    survey: content.survey.map((row) => ({ ...row })),
    choices: content.choices ? content.choices.map((c) => ({ ...c })) : [],
    translated: [...content.translated],
    translations: [...content.translations],
  };

  if (isAppend) {
    updatedContent.translations.push(targetLangLabel);
    // Extend every translatable array in survey rows
    for (const row of updatedContent.survey) {
      for (const field of translatableFields) {
        const arr = row[field] as (string | null)[] | undefined;
        if (Array.isArray(arr)) arr.push(null);
      }
    }
    // Extend every translatable array in choices
    for (const choice of updatedContent.choices ?? []) {
      for (const field of translatableFields) {
        const arr = choice[field] as (string | null)[] | undefined;
        if (Array.isArray(arr)) arr.push(null);
      }
    }
  }

  const groupTypes = new Set(["begin_group", "begin_repeat"]);

  // Filter target survey rows; groups are always included (they have translatable labels)
  const targetSet = new Set(questionNames.length > 0 ? questionNames : []);
  const targetRows = updatedContent.survey.filter(
    (row) => row.name && (groupTypes.has(row.type) || targetSet.size === 0 || targetSet.has(row.name))
  );

  // Collect list_names referenced by target rows (for choice translation)
  const targetListNames = new Set<string>();
  for (const row of targetRows) {
    if (row.select_from_list_name) targetListNames.add(row.select_from_list_name);
  }

  // Translate survey rows
  for (const row of targetRows) {
    const fields: Record<string, string> = {};
    for (const field of translatableFields) {
      const arr = row[field] as (string | null)[] | undefined;
      const val = arr?.[0] ?? "";
      if (val.trim()) fields[field] = val;
    }

    if (Object.keys(fields).length === 0) {
      yield { item: row.name ?? "(unnamed)", status: "skipped" };
      continue;
    }

    try {
      const translated = await translateFields(fields, sourceLang, targetLang, instructions, openAiApiKey);
      for (const field of Object.keys(translated)) {
        const arr = row[field] as (string | null)[];
        arr[targetIndex] = translated[field];
      }
      yield { item: row.name ?? "(unnamed)", status: "translated" };
    } catch (err) {
      yield {
        item: row.name ?? "(unnamed)",
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Translate choices
  for (const listName of targetListNames) {
    const listChoices = (updatedContent.choices ?? []).filter(
      (c) => c.list_name === listName
    );
    if (listChoices.length === 0) continue;

    // Batch: keys are "{choice_name}.{field}"
    const fields: Record<string, string> = {};
    for (const choice of listChoices) {
      for (const field of translatableFields) {
        const arr = choice[field] as (string | null)[] | undefined;
        const val = arr?.[0] ?? "";
        if (val.trim()) fields[`${choice.name}.${field}`] = val;
      }
    }

    if (Object.keys(fields).length === 0) {
      yield { item: `choices:${listName}`, status: "skipped" };
      continue;
    }

    try {
      const translated = await translateFields(fields, sourceLang, targetLang, instructions, openAiApiKey);
      for (const choice of listChoices) {
        for (const field of translatableFields) {
          const key = `${choice.name}.${field}`;
          if (translated[key] !== undefined) {
            const arr = choice[field] as (string | null)[];
            arr[targetIndex] = translated[key];
          }
        }
      }
      yield { item: `choices:${listName}`, status: "translated" };
    } catch (err) {
      yield {
        item: `choices:${listName}`,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const newVersionId = await patchFormContent(serverUrl, assetUid, koboToken, updatedContent);

  if (req.redeploy) {
    await redeployForm(serverUrl, assetUid, koboToken, newVersionId);
  }
}
