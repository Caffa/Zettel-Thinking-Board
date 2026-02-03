import {ItemView, Notice, Setting, WorkspaceLeaf} from "obsidian";
import type {IZettelThinkingBoardPlugin} from "../types";
import {terminateKernel} from "../engine/kernelManager";

export const ZETTEL_CONTROLS_VIEW_TYPE = "zettel-controls";

/** In-memory env vars (not persisted). */
const envVars: Record<string, string> = {};

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
		const el = this.containerEl.createDiv({ cls: "ztb-controls-container" });

		// Model mapping (persisted; same as settings)
		el.createEl("h4", { text: "Model mapping", cls: "ztb-section-title" });
		new Setting(el)
			.setName("Orange (primary LLM)")
			.setDesc("Ollama model for orange nodes")
			.addText((text) =>
				text
					.setPlaceholder("e.g. llama2")
					.setValue(this.plugin.settings.ollamaOrangeModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaOrangeModel = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(el)
			.setName("Purple (secondary LLM)")
			.setDesc("Ollama model for purple nodes")
			.addText((text) =>
				text
					.setPlaceholder("e.g. mistral")
					.setValue(this.plugin.settings.ollamaPurpleModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaPurpleModel = value;
						await this.plugin.saveSettings();
					})
			);

		// Kernel controls
		el.createEl("h4", { text: "Kernel controls", cls: "ztb-section-title" });
		new Setting(el)
			.setName("Restart Python kernel")
			.setDesc("Restart the kernel for the active canvas")
			.addButton((btn) =>
				btn.setButtonText("Restart kernel").onClick(() => {
					const view = this.plugin.getActiveCanvasView();
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
		const consoleEl = el.createDiv({ cls: "ztb-console" });
		const appendLog = (line: string) => {
			const p = consoleEl.createEl("p", { cls: "ztb-console-line" });
			p.setText(line);
			consoleEl.scrollTop = consoleEl.scrollHeight;
		};

		const wireKernelLog = () => {
			const kernel = this.plugin.getKernelForActiveCanvas();
			if (kernel) kernel.onLog = (line: string) => {
				if (this.containerEl.isConnected) appendLog(line);
			};
		};
		wireKernelLog();
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("active-leaf-change", wireKernelLog)
		);
	}

	async onClose(): Promise<void> {
		this.containerEl.empty();
	}
}
