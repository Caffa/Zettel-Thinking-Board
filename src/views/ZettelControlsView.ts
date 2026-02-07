import {ItemView, Notice, Setting, WorkspaceLeaf} from "obsidian";
import type {IZettelThinkingBoardPlugin} from "../types";
import {terminateKernel} from "../engine/kernelManager";
import {fetchOllamaModels} from "../engine/ollama";
import {DEFAULT_SETTINGS, getPresetColor} from "../settings";
import type {CanvasColor} from "../settings";

export const ZETTEL_CONTROLS_VIEW_TYPE = "zettel-controls";

/** In-memory env vars (not persisted). */
const envVars: Record<string, string> = {};

/** Resolve canvas color setting to a CSS value for swatch background. */
function resolveColorValue(value: CanvasColor): string {
	const v = (value ?? "").toString().trim();
	if (/^[1-6]$/.test(v)) return getPresetColor(Number(v) as 1 | 2 | 3 | 4 | 5 | 6);
	return v || "#888";
}

const MODEL_GROUP_TITLES: Record<"orange" | "purple" | "red", string> = {
	orange: "Primary model",
	purple: "Secondary model",
	red: "Tertiary model",
};

export class ZettelControlsView extends ItemView {
	constructor(leaf: WorkspaceLeaf, public readonly plugin: IZettelThinkingBoardPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return ZETTEL_CONTROLS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Zettel Controls";
	}

	getIcon(): string {
		return "circuit-board";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("ztb-controls-view");
		// Clear pre-existing children so our content is the only child and receives layout
		this.containerEl.empty();
		const scrollWrap = this.containerEl.createDiv({ cls: "ztb-controls-view-content" });
		const el = scrollWrap.createDiv({ cls: "ztb-controls-container" });

		// Model mapping (persisted; same as settings) — one grouped block per model
		el.createEl("h4", { text: "Model mapping", cls: "ztb-section-title" });
		const modelGroupsContainer = el.createDiv({ cls: "ztb-controls-model-groups" });
		const loadingEl = modelGroupsContainer.createDiv({ cls: "ztb-ollama-loading" });
		loadingEl.setText("Loading Ollama models…");

		const addModelGroup = (
			parent: HTMLElement,
			role: "orange" | "purple" | "red",
			modelKey: "ollamaOrangeModel" | "ollamaPurpleModel" | "ollamaRedModel",
			temperatureKey: "ollamaOrangeTemperature" | "ollamaPurpleTemperature" | "ollamaRedTemperature",
			colorKey: "colorOrange" | "colorPurple" | "colorRed",
			models: string[] | null
		) => {
			const group = parent.createDiv({ cls: "ztb-controls-model-group" });
			const header = group.createDiv({ cls: "ztb-controls-model-group-header" });
			const title = header.createSpan({ cls: "ztb-controls-model-group-title", text: MODEL_GROUP_TITLES[role] });
			const swatch = header.createSpan({ cls: "ztb-color-swatch ztb-controls-model-swatch" });
			swatch.style.backgroundColor = resolveColorValue(this.plugin.settings[colorKey] as CanvasColor);

			const currentModel = this.plugin.settings[modelKey] ?? "";
			if (models && models.length > 0) {
				new Setting(group)
					.setName("Model")
					.setDesc("Ollama model for this model node")
					.addDropdown((dropdown) => {
						dropdown.addOption("", "— Select model —");
						for (const name of models) dropdown.addOption(name, name);
						dropdown.setValue(currentModel && models.includes(currentModel) ? currentModel : "");
						dropdown.onChange(async (value) => {
							this.plugin.settings[modelKey] = value;
							await this.plugin.saveSettings();
						});
					});
			} else {
				new Setting(group)
					.setName("Model")
					.setDesc("Ollama model name (e.g. llama2). Enter manually if Ollama is not reachable.")
					.addText((text) =>
						text
							.setPlaceholder("e.g. llama2")
							.setValue(currentModel)
							.onChange(async (value) => {
								this.plugin.settings[modelKey] = value;
								await this.plugin.saveSettings();
							})
					);
			}
			const tempVal = Number(this.plugin.settings[temperatureKey]) ?? DEFAULT_SETTINGS[temperatureKey];
			const tempSetting = new Setting(group)
				.setName("Temperature")
				.setDesc("Higher = more creative, lower = more deterministic (0–2).")
				.addSlider((slider) => slider
					.setLimits(0, 2, 0.1)
					.setValue(tempVal)
					.onChange(async (value) => {
						this.plugin.settings[temperatureKey] = value;
						tempValueSpan.setText(String(value));
						await this.plugin.saveSettings();
					}));
			const tempDisplay = tempSetting.controlEl.createSpan({ cls: "ztb-controls-temp-display" });
			tempDisplay.createSpan({ text: "Current: " });
			const tempValueSpan = tempDisplay.createSpan({ cls: "ztb-controls-temp-value", text: String(tempVal) });
		};

		(async () => {
			const models = await fetchOllamaModels();
			loadingEl.remove();
			addModelGroup(modelGroupsContainer, "orange", "ollamaOrangeModel", "ollamaOrangeTemperature", "colorOrange", models.length > 0 ? models : null);
			addModelGroup(modelGroupsContainer, "purple", "ollamaPurpleModel", "ollamaPurpleTemperature", "colorPurple", models.length > 0 ? models : null);
			addModelGroup(modelGroupsContainer, "red", "ollamaRedModel", "ollamaRedTemperature", "colorRed", models.length > 0 ? models : null);
		})();

		// Kernel controls
		el.createEl("h4", { text: "Kernel controls", cls: "ztb-section-title" });
		new Setting(el)
			.setName("Restart Python kernel")
			.setDesc("Restart the kernel for the active canvas")
			.addButton((btn) =>
				btn.setButtonText("Restart kernel").onClick(() => {
					const view = this.plugin.getActiveOrFirstCanvasView();
					if (!view) {
						new Notice("Open a canvas first.");
						return;
					}
					terminateKernel(view.file.path);
					new Notice("Kernel restarted for this canvas.");
				})
			);

		// Environment variables (in-memory only)
		el.createEl("h4", { text: "Environment variables", cls: "ztb-section-title" });
		const envDesc = el.createEl("p", { cls: "ztb-env-desc" });
		envDesc.setText("Key-value pairs for Python (not persisted).");
		const envList = el.createDiv({ cls: "ztb-env-list" });
		const addEnvRow = (key = "", value = "") => {
			const row = envList.createDiv({ cls: "ztb-env-row" });
			const keyInp = row.createEl("input", { type: "text", cls: "ztb-env-key" });
			keyInp.placeholder = "KEY";
			keyInp.value = key;
			const valInp = row.createEl("input", { type: "text", cls: "ztb-env-val" });
			valInp.placeholder = "value";
			valInp.value = value;
			keyInp.addEventListener("change", () => {
				if (key) delete envVars[key];
				envVars[keyInp.value.trim()] = valInp.value.trim();
			});
			valInp.addEventListener("change", () => {
				envVars[keyInp.value.trim()] = valInp.value.trim();
			});
			row.createEl("button", { text: "Remove", cls: "ztb-env-remove" }).addEventListener("click", () => {
				delete envVars[keyInp.value.trim()];
				row.remove();
			});
		};
		for (const [k, v] of Object.entries(envVars)) addEnvRow(k, v);
		const addBtn = el.createEl("button", { text: "Add variable", cls: "ztb-env-add" });
		addBtn.addEventListener("click", () => addEnvRow());

		// Console (obsidian_log output)
		el.createEl("h4", { text: "Console", cls: "ztb-section-title" });
		const consoleTip = el.createEl("p", { cls: "ztb-controls-tip" });
		consoleTip.setText("In Python cards, call obsidian_log('your message') to see output here.");
		const consoleEl = el.createDiv({ cls: "ztb-console" });
		const appendLog = (line: string) => {
			const p = consoleEl.createEl("p", { cls: "ztb-console-line" });
			p.setText(line);
			consoleEl.scrollTop = consoleEl.scrollHeight;
		};

		// Error console (timeouts, stderr, kernel errors)
		const errorHeader = el.createDiv({ cls: "ztb-error-console-header" });
		errorHeader.createEl("h4", { text: "Error console", cls: "ztb-section-title" });
		const clearErrorBtn = errorHeader.createEl("button", { cls: "ztb-console-clear", text: "Clear" });
		clearErrorBtn.addEventListener("click", () => {
			errorConsoleEl.empty();
		});
		const errorTip = el.createEl("p", { cls: "ztb-controls-tip" });
		errorTip.setText("Python errors, timeouts, and stderr appear here.");
		const errorConsoleEl = el.createDiv({ cls: "ztb-console ztb-error-console" });
		const appendError = (message: string) => {
			if (!this.containerEl.isConnected) return;
			const p = errorConsoleEl.createEl("p", { cls: "ztb-console-line ztb-error-line" });
			p.setText(message);
			errorConsoleEl.scrollTop = errorConsoleEl.scrollHeight;
		};

		const wireKernelLog = () => {
			const kernel = this.plugin.getKernelForActiveCanvas();
			if (kernel) {
				kernel.onLog = (line: string) => {
					if (this.containerEl.isConnected) appendLog(line);
				};
				kernel.onError = (message: string) => {
					if (this.containerEl.isConnected) appendError(message);
				};
			}
		};
		wireKernelLog();
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("active-leaf-change", wireKernelLog)
		);

		// Guide tips (features that are not immediately obvious)
		el.createEl("h4", { text: "Guide tips", cls: "ztb-section-title" });
		const guideDetails = el.createEl("details", { cls: "ztb-guide-details" });
		guideDetails.createEl("summary", { cls: "ztb-guide-summary", text: "How to use the canvas" });
		const guideList = guideDetails.createEl("ul", { cls: "ztb-guide-list" });
		const tips = [
			"Each color is a different way to work with text: one color might ask an AI a question, another might run a short Python snippet, and the green card is where the result shows up.",
			"Text (yellow) nodes are input pass-through: their content is sent to the next node. Uncolored or unused-color cards are not connected and do not add to any prompt.",
			"An arrow from one card to another sends its text as input. You can change how it's combined by clicking the arrow's label.",
			"Right-click a card and choose Run node to run just that card, or Run chain to run it and every card that feeds into it.",
			"The green card is where answers and results appear. It gets created or updated when you run an AI or Python card.",
			"You can plug text from one card into another by using {{var:name}} in the card text and giving the edge that variable name as its label.",
			"Python (blue) cards are auto-wrapped in a code block so # comments render as comments; the plugin adds the fence when you run the node if needed.",
			"Use the command \"Create tutorial canvas\" for a full showcase: every node type, concat vs variable injection, Run buttons, and this sidebar.",
		];
		for (const tip of tips) {
			const li = guideList.createEl("li");
			li.setText(tip);
		}
	}

	async onClose(): Promise<void> {
		this.containerEl.removeClass("ztb-controls-view");
		this.containerEl.empty();
	}
}
