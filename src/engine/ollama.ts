const OLLAMA_BASE = "http://localhost:11434";

/** Response from GET /api/tags */
interface OllamaTagsResponse {
	models?: { name: string }[];
}

/** Fetch list of available Ollama model names. Returns [] if Ollama is not running or request fails. */
export async function fetchOllamaModels(): Promise<string[]> {
	try {
		const res = await fetch(`${OLLAMA_BASE}/api/tags`);
		if (!res.ok) return [];
		const data = (await res.json()) as OllamaTagsResponse;
		const models = data.models ?? [];
		return models.map((m) => m.name).filter(Boolean);
	} catch {
		return [];
	}
}

/** Runtime options for Ollama /api/generate (sent under the "options" key). */
export interface OllamaGenerateRequestOptions {
	temperature?: number;
	num_predict?: number;
	top_p?: number;
}

export interface OllamaGenerateOptions {
	model: string;
	prompt: string;
	stream?: boolean;
	options?: OllamaGenerateRequestOptions;
}

/** Call Ollama /api/generate and return the response string. */
export async function ollamaGenerate(options: OllamaGenerateOptions): Promise<string> {
	const {model, prompt, stream = false, options: requestOptions} = options;
	const url = `${OLLAMA_BASE}/api/generate`;
	const payload: { model: string; prompt: string; stream: boolean; options?: OllamaGenerateRequestOptions } = {
		model,
		prompt,
		stream,
	};
	if (requestOptions && Object.keys(requestOptions).length > 0) {
		payload.options = requestOptions;
	}
	const body = JSON.stringify(payload);
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
