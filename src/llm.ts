export async function translateFields(
  fields: Record<string, string>,
  sourceLang: string,
  targetLang: string,
  instructions: string,
  openAiApiKey: string
): Promise<Record<string, string>> {
  const systemPrompt = [
    `You are a professional form translator. Translate the given survey form text from ${sourceLang} into ${targetLang}.`,
    `Preserve the meaning and tone exactly. Do not add or remove information.`,
    `Return ONLY a valid JSON object with the same keys as the input — no explanation, no markdown, no extra text.`,
    instructions.trim() ? `\nAdditional instructions:\n${instructions.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(fields) },
      ],
    }),
  });

  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = data.choices[0]?.message?.content ?? "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`LLM returned unexpected shape: ${raw.slice(0, 200)}`);
  }

  const result: Record<string, string> = {};
  for (const key of Object.keys(fields)) {
    const val = (parsed as Record<string, unknown>)[key];
    result[key] = typeof val === "string" ? val : fields[key];
  }
  return result;
}
