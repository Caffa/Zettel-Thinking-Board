import {App, Plugin, PluginSettingTab, Setting} from "obsidian";
import {fetchOllamaModels} from "./engine/ollama";

/** CanvasColor: Obsidian preset '1'..'6' or hex e.g. '#FFA500' */
export type CanvasColor = string;

export type NodeRole = "orange" | "purple" | "blue" | "yellow" | "green";

/** Default label for each role when no model name is set. */
export const ROLE_LABELS: Record<NodeRole, string> = {
	orange: "Model (primary)",
	purple: "Model (secondary)",
	blue: "Python",
	yellow: "Comment",
	green: "Output",
};

/** Display label for the canvas: uses model name for primary/secondary (e.g. "Model: Deepseek 32b"). */
export function getRoleLabel(role: NodeRole, settings: ZettelPluginSettings): string {
	if (role === "orange") {
		const name = (settings.ollamaOrangeModel || "").trim();
		return name ? `Model: ${name}` : ROLE_LABELS.orange;
	}
	if (role === "purple") {
		const name = (settings.ollamaPurpleModel || "").trim();
		return name ? `Model: ${name}` : ROLE_LABELS.purple;
	}
	return ROLE_LABELS[role];
}

export interface ZettelPluginSettings {
	ollamaOrangeModel: string;
	ollamaPurpleModel: string;
	colorOrange: CanvasColor;
	colorPurple: CanvasColor;
	colorBlue: CanvasColor;
	colorYellow: CanvasColor;
	colorGreen: CanvasColor;
	showNodeRoleLabels: boolean;
	pythonPath: string;
}

export const DEFAULT_SETTINGS: ZettelPluginSettings = {
	ollamaOrangeModel: "",
	ollamaPurpleModel: "",
	colorOrange: "1",
	colorPurple: "2",
	colorBlue: "3",
	colorYellow: "4",
	colorGreen: "5",
	showNodeRoleLabels: true,
	pythonPath: "python3",
};

/** Fallback hex for preset 1–6 when CSS var is missing or empty. */
const PRESET_HEX: Record<string, string> = {
	"1": "#e68619",
	"2": "#a855f7",
	"3": "#3b82f6",
	"4": "#eab308",
	"5": "#22c55e",
	"6": "#ef4444",
};

/** Resolve preset color: use --canvas-color-N when valid, else fallback hex. */
export function getPresetColor(presetNumber: 1 | 2 | 3 | 4 | 5 | 6): string {
	const n = Math.max(1, Math.min(6, presetNumber));
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(`--canvas-color-${n}`)
		.trim();
	if (value && /^(#[0-9A-Fa-f]{3,8}|rgb|rgba|hsl|hsla)/.test(value)) return value;
	return PRESET_HEX[String(n)] ?? "#888";
}

/** Obsidian canvas preset 1–6: label for settings UI. */
const PRESET_COLORS: { value: CanvasColor; label: string }[] = [
	{ value: "1", label: "Preset 1" },
	{ value: "2", label: "Preset 2" },
	{ value: "3", label: "Preset 3" },
	{ value: "4", label: "Preset 4" },
	{ value: "5", label: "Preset 5" },
	{ value: "6", label: "Preset 6" },
];

const PRESET_SWATCH_CLASS = "ztb-color-swatch--preset-";

function setSwatchToPreset(swatch: HTMLElement, presetValue: string): void {
	for (let i = 1; i <= 6; i++) swatch.classList.remove(PRESET_SWATCH_CLASS + i);
	swatch.style.backgroundColor = getPresetColor(Number(presetValue) as 1 | 2 | 3 | 4 | 5 | 6);
}

function setSwatchToCustom(swatch: HTMLElement, hex: string): void {
	for (let i = 1; i <= 6; i++) swatch.classList.remove(PRESET_SWATCH_CLASS + i);
	swatch.style.backgroundColor = hex || "#888";
}

function addColorSetting(
	containerEl: HTMLElement,
	plugin: Plugin & { settings: ZettelPluginSettings; saveSettings(): Promise<void> },
	role: NodeRole,
	label: string,
	desc: string
): void {
	const key = `color${role.charAt(0).toUpperCase() + role.slice(1)}` as keyof ZettelPluginSettings;
	const current = plugin.settings[key] as CanvasColor;
	const isPreset = /^[1-6]$/.test(current);
	const presetValue = isPreset ? current : "1";
	const customValue = isPreset ? "" : current;

	const row = containerEl.createDiv({ cls: "setting-item" });
	const info = row.createDiv({ cls: "setting-item-info" });
	info.createEl("div", { cls: "setting-item-name", text: label });
	info.createEl("div", { cls: "setting-item-description", text: desc });
	const control = row.createDiv({ cls: "setting-item-control" });

	const swatchWrap = control.createSpan({ cls: "ztb-color-swatch-wrap" });
	const swatch = swatchWrap.createSpan({ cls: "ztb-color-swatch" });
	if (isPreset) {
		setSwatchToPreset(swatch, presetValue);
		swatch.setAttr("title", PRESET_COLORS.find((p) => p.value === presetValue)?.label ?? "Preset");
	} else {
		setSwatchToCustom(swatch, customValue || "#888");
		swatch.setAttr("title", customValue || "Custom");
	}

	const dropdown = control.createEl("select", { cls: "dropdown" });
	PRESET_COLORS.forEach((p) => {
		const opt = dropdown.createEl("option", { text: p.label });
		opt.value = p.value;
		if (p.value === presetValue) opt.selected = true;
	});
	const customOpt = dropdown.createEl("option", { text: "Custom (hex)" });
	customOpt.value = "custom";
	if (!isPreset) customOpt.selected = true;
	const updateSwatch = () => {
		const v = dropdown.value;
		if (v === "custom") {
			setSwatchToCustom(swatch, customHex.value.trim() || "#888");
			swatch.setAttr("title", customHex.value.trim() || "Custom");
		} else {
			setSwatchToPreset(swatch, v);
			swatch.setAttr("title", PRESET_COLORS.find((x) => x.value === v)?.label ?? "Preset");
		}
	};
	dropdown.addEventListener("change", () => {
		const v = dropdown.value;
		customHex.style.display = v === "custom" ? "inline-block" : "none";
		if (v === "custom") {
			(plugin.settings as unknown as Record<string, CanvasColor>)[key] = customHex.value.trim() || "#000000";
		} else {
			(plugin.settings as unknown as Record<string, CanvasColor>)[key] = v;
		}
		updateSwatch();
		plugin.saveSettings();
	});

	const customHex = control.createEl("input", {
		type: "text",
		cls: "ztb-color-hex",
		attr: { placeholder: "#RRGGBB" },
	});
	customHex.value = customValue;
	customHex.style.display = isPreset ? "none" : "inline-block";
	customHex.style.width = "6em";
	customHex.style.marginLeft = "6px";
	customHex.addEventListener("input", () => {
		const hex = customHex.value.trim();
		if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
			(plugin.settings as unknown as Record<string, CanvasColor>)[key] = hex;
			swatch.style.backgroundColor = hex;
			plugin.saveSettings();
		}
	});
}

export class ZettelSettingTab extends PluginSettingTab {
	plugin: Plugin & { settings: ZettelPluginSettings; saveSettings(): Promise<void> };

	constructor(app: App, plugin: Plugin & { settings: ZettelPluginSettings; saveSettings(): Promise<void> }) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		const s = this.plugin.settings;

		// How to run: one-line hint (per UX suggestion)
		const hint = containerEl.createDiv({ cls: "ztb-settings-hint setting-item-description" });
		hint.setText("Right-click a node on the canvas and choose Run node or Run chain.");

		// Execution: what runs (primary model, secondary model, Python path)
		const executionSection = containerEl.createDiv({ cls: "ztb-settings-section" });
		executionSection.createEl("h4", { text: "Execution", cls: "ztb-section-title" });
		const ollamaContainer = executionSection.createDiv({ cls: "ztb-ollama-settings" });
		const loadingEl = ollamaContainer.createDiv({ cls: "ztb-ollama-loading" });
		loadingEl.setText("Loading Ollama models…");
		(async () => {
			const models = await fetchOllamaModels();
			loadingEl.remove();
			if (models.length === 0) {
				const fallback = ollamaContainer.createDiv({ cls: "ztb-ollama-fallback" });
				fallback.createEl("p", { text: "Ollama not reachable or no models. Enter model names manually." });
				new Setting(ollamaContainer)
					.setName("Model node (primary)")
					.setDesc("Ollama model used when you run a primary model node (e.g. llama2)")
					.addText((text) => text
						.setPlaceholder("e.g. llama2")
						.setValue(s.ollamaOrangeModel)
						.onChange(async (value) => {
							this.plugin.settings.ollamaOrangeModel = value;
							await this.plugin.saveSettings();
						}));
				new Setting(ollamaContainer)
					.setName("Model node (secondary)")
					.setDesc("Ollama model used when you run a secondary model node")
					.addText((text) => text
						.setPlaceholder("e.g. mistral")
						.setValue(s.ollamaPurpleModel)
						.onChange(async (value) => {
							s.ollamaPurpleModel = value;
							await this.plugin.saveSettings();
						}));
				return;
			}
			new Setting(ollamaContainer)
				.setName("Model node (primary)")
				.setDesc("Ollama model used when you run a primary model node")
				.addDropdown((dropdown) => {
					dropdown.addOption("", "— Select model —");
					for (const name of models) dropdown.addOption(name, name);
					dropdown.setValue(s.ollamaOrangeModel && models.includes(s.ollamaOrangeModel) ? s.ollamaOrangeModel : "");
					dropdown.onChange(async (value) => {
						this.plugin.settings.ollamaOrangeModel = value;
						await this.plugin.saveSettings();
					});
				});
			new Setting(ollamaContainer)
				.setName("Model node (secondary)")
				.setDesc("Ollama model used when you run a secondary model node")
				.addDropdown((dropdown) => {
					dropdown.addOption("", "— Select model —");
					for (const name of models) dropdown.addOption(name, name);
					dropdown.setValue(s.ollamaPurpleModel && models.includes(s.ollamaPurpleModel) ? s.ollamaPurpleModel : "");
					dropdown.onChange(async (value) => {
						s.ollamaPurpleModel = value;
						await this.plugin.saveSettings();
					});
				});
		})();

		new Setting(executionSection)
			.setName("Python path")
			.setDesc("Path to Python executable for Python nodes (e.g. python3 or /usr/bin/python3)")
			.addText((text) => text
				.setPlaceholder("python3")
				.setValue(s.pythonPath)
				.onChange(async (value) => {
					s.pythonPath = value || "python3";
					await this.plugin.saveSettings();
				}));

		// Node colors: how it looks (role-first labels, effect-focused descriptions)
		const colorsSection = containerEl.createDiv({ cls: "ztb-settings-section" });
		colorsSection.createEl("h4", { text: "Node colors", cls: "ztb-section-title" });
		addColorSetting(
			colorsSection,
			this.plugin,
			"orange",
			"Model node (primary)",
			"Color for the primary model node on the canvas"
		);
		addColorSetting(
			colorsSection,
			this.plugin,
			"purple",
			"Model node (secondary)",
			"Color for the secondary model node on the canvas"
		);
		addColorSetting(
			colorsSection,
			this.plugin,
			"blue",
			"Python node",
			"Color for the Python node on the canvas"
		);
		addColorSetting(
			colorsSection,
			this.plugin,
			"yellow",
			"Comment node",
			"Color for the comment (pass-through) node on the canvas"
		);
		addColorSetting(
			colorsSection,
			this.plugin,
			"green",
			"Output node",
			"Color for auto-generated output nodes on the canvas"
		);

		new Setting(colorsSection)
			.setName("Show role labels on canvas")
			.setDesc("Show a floating label above each node (e.g. Comment, Python) based on its color")
			.addToggle((toggle) => toggle
				.setValue(s.showNodeRoleLabels)
				.onChange(async (value) => {
					this.plugin.settings.showNodeRoleLabels = value;
					await this.plugin.saveSettings();
				}));
	}
}
