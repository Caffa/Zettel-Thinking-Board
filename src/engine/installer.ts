import {Notice, Platform} from "obsidian";

/** Recommended Ollama models with descriptions */
export interface RecommendedModel {
	name: string;
	size: string;
	description: string;
	useCase: string;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
	{
		name: "gemma3:4b",
		size: "3.3 GB",
		description: "Fast, compact model for text cleaning",
		useCase: "Quick text processing, formatting, and simple tasks",
	},
	{
		name: "gemma3:27b",
		size: "17 GB",
		description: "Large, high-quality model for conversation",
		useCase: "Best for complex conversations and detailed responses",
	},
	{
		name: "deepseek-r1:32b",
		size: "19 GB",
		description: "Advanced reasoning model for logical breakdown",
		useCase: "Complex analysis, logical reasoning, and structured thinking",
	},
];

/** Check Python installation status by trying to spawn a process */
export async function checkPythonInstallation(): Promise<{
	installed: boolean;
	version?: string;
	path?: string;
}> {
	// In Obsidian desktop, we can use require for Node modules (desktop only)
	// Check if we're in a Node.js environment
	if (typeof require === "undefined" || !Platform.isDesktopApp) {
		return {installed: false};
	}

	try {
		// Dynamic require to avoid bundling issues
		const {execSync} = require("child_process") as typeof import("child_process");
		const pythonCommands = ["python3", "python"];

		for (const cmd of pythonCommands) {
			try {
				const version = execSync(`${cmd} --version`, {
					encoding: "utf8",
					timeout: 5000,
				}).trim();

				const path = execSync(
					Platform.isWin ? `where ${cmd}` : `which ${cmd}`,
					{encoding: "utf8", timeout: 5000}
				).trim().split("\n")[0];

				return {
					installed: true,
					version,
					path,
				};
			} catch {
				continue;
			}
		}
	} catch (error) {
		console.error("Error checking Python installation:", error);
	}

	return {installed: false};
}

/** Check Ollama installation status */
export async function checkOllamaInstallation(): Promise<{
	installed: boolean;
	running: boolean;
	version?: string;
}> {
	// First check if Ollama is running (most important check)
	try {
		const res = await fetch("http://localhost:11434/api/tags", {
			signal: AbortSignal.timeout(3000),
		});
		if (res.ok) {
			// Ollama is running, now try to get version
			let version = "Unknown";
			if (typeof require !== "undefined" && Platform.isDesktopApp) {
				try {
					const {execSync} = require("child_process") as typeof import("child_process");
					version = execSync("ollama --version", {
						encoding: "utf8",
						timeout: 5000,
					}).trim();
				} catch {
					// Version check failed but service is running
				}
			}
			return {installed: true, running: true, version};
		}
	} catch {
		// Service not running, check if installed
	}

	// Check if ollama command exists
	if (typeof require !== "undefined" && Platform.isDesktopApp) {
		try {
			const {execSync} = require("child_process") as typeof import("child_process");
			const version = execSync("ollama --version", {
				encoding: "utf8",
				timeout: 5000,
			}).trim();
			return {installed: true, running: false, version};
		} catch {
			// Command doesn't exist
		}
	}

	return {installed: false, running: false};
}

/** Check if a specific Ollama model is installed */
export async function checkModelInstalled(modelName: string): Promise<boolean> {
	try {
		const res = await fetch("http://localhost:11434/api/tags");
		if (!res.ok) return false;

		const data = (await res.json()) as { models?: { name: string }[] };
		const models = data.models ?? [];
		return models.some((m) => m.name === modelName);
	} catch {
		return false;
	}
}

/** Get installation instructions for Python */
export function getPythonInstallInstructions(): string {
	if (Platform.isMacOS) {
		return "Install Python using Homebrew:\n\nbrew install python3\n\nOr download from python.org";
	} else if (Platform.isWin) {
		return "Download Python from python.org and run the installer.\n\nMake sure to check 'Add Python to PATH' during installation.";
	} else {
		return "Install Python using your package manager:\n\nsudo apt install python3\n\nOr equivalent for your distribution.";
	}
}

/** Get installation instructions for Ollama */
export function getOllamaInstallInstructions(): string {
	if (Platform.isMacOS) {
		return "Install Ollama:\n\n1. Visit ollama.ai and download the macOS app\n2. Or use Homebrew: brew install ollama\n3. Run 'ollama serve' to start the service";
	} else if (Platform.isWin) {
		return "Install Ollama:\n\n1. Visit ollama.ai and download the Windows installer\n2. Run the installer\n3. Ollama will start automatically as a service";
	} else {
		return "Install Ollama:\n\n1. Run: curl -fsSL https://ollama.ai/install.sh | sh\n2. Start the service: ollama serve";
	}
}

/** Start Ollama service (if installed but not running) */
export async function startOllamaService(): Promise<boolean> {
	if (typeof require === "undefined" || !Platform.isDesktopApp) {
		new Notice("Cannot start Ollama service: desktop app required");
		return false;
	}

	try {
		// Check if already running
		const status = await checkOllamaInstallation();
		if (status.running) return true;

		if (!status.installed) {
			new Notice("Ollama is not installed. Please install it first.");
			return false;
		}

		const {exec} = require("child_process") as typeof import("child_process");

		// Try to start ollama
		if (Platform.isMacOS || Platform.isLinux) {
			// Background process
			exec("nohup ollama serve > /dev/null 2>&1 &");
		} else if (Platform.isWin) {
			// Windows: start as background process
			exec("start /B ollama serve");
		}

		// Wait for service to start
		await new Promise((resolve) => setTimeout(resolve, 3000));

		// Verify it's running
		const newStatus = await checkOllamaInstallation();
		return newStatus.running;
	} catch (error) {
		console.error("Failed to start Ollama service:", error);
		return false;
	}
}

/** Download an Ollama model (returns progress callback) */
export async function downloadOllamaModel(
	modelName: string,
	onProgress?: (progress: string) => void
): Promise<boolean> {
	if (typeof require === "undefined" || !Platform.isDesktopApp) {
		new Notice("Cannot download models: desktop app required");
		return false;
	}

	try {
		// Check if Ollama is running
		const status = await checkOllamaInstallation();
		if (!status.running) {
			new Notice("Ollama service is not running. Please start it first.");
			return false;
		}

		new Notice(`Downloading ${modelName}... This may take several minutes.`);

		const {exec} = require("child_process") as typeof import("child_process");

		// Use ollama pull command
		const pullProcess = exec(`ollama pull ${modelName}`);

		// Capture output for progress
		if (pullProcess.stdout && onProgress) {
			pullProcess.stdout.on("data", (data: Buffer) => {
				onProgress(data.toString());
			});
		}

		// Wait for completion
		await new Promise<void>((resolve, reject) => {
			pullProcess.on("exit", (code: number | null) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Model download failed with code ${code}`));
				}
			});
			pullProcess.on("error", reject);
		});

		new Notice(`✓ ${modelName} downloaded successfully`);
		return true;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to download ${modelName}: ${errorMsg}`);
		console.error("Model download error:", error);
		return false;
	}
}

/** Open system browser to installation page */
export function openInstallationPage(type: "python" | "ollama"): void {
	const urls = {
		python: "https://www.python.org/downloads/",
		ollama: "https://ollama.ai/download",
	};

	window.open(urls[type], "_blank");
}
