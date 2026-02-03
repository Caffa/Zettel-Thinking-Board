const OLLAMA_BASE = "http://localhost:11434";

export interface OllamaGenerateOptions {
	model: string;
	prompt: string;
	stream?: boolean;
}

/** Call Ollama /api/generate and return the response string. */
export async function ollamaGenerate(options: OllamaGenerateOptions): Promise<string> {
	const {model, prompt, stream = false} = options;
	const url = `${OLLAMA_BASE}/api/generate`;
	const body = JSON.stringify({ model, prompt, stream });
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Ollama error ${res.status}: ${text}`);
	}
	const data = (await res.json()) as { response?: string };
	return data.response ?? "";
}
