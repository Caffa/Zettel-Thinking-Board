import {App, PluginSettingTab, Setting} from "obsidian";
import ZettelThinkingBoardPlugin from "./main";

/** CanvasColor: Obsidian preset '1'..'6' or hex e.g. '#FFA500' */
export type CanvasColor = string;

export type NodeRole = "orange" | "purple" | "blue" | "yellow" | "green";

export interface ZettelPluginSettings {
	ollamaOrangeModel: string;
	ollamaPurpleModel: string;
	colorOrange: CanvasColor;
	colorPurple: CanvasColor;
	colorBlue: CanvasColor;
	colorYellow: CanvasColor;
	colorGreen: CanvasColor;
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
	pythonPath: "python3",
};

const PRESET_COLORS: { value: CanvasColor; label: string }[] = [
	{ value: "1", label: "Preset 1" },
	{ value: "2", label: "Preset 2" },
	{ value: "3", label: "Preset 3" },
	{ value: "4", label: "Preset 4" },
	{ value: "5", label: "Preset 5" },
	{ value: "6", label: "Preset 6" },
];

function addColorSetting(
	containerEl: HTMLElement,
	plugin: ZettelThinkingBoardPlugin,
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

	const dropdown = control.createEl("select", { cls: "dropdown" });
	PRESET_COLORS.forEach((p) => {
		const opt = dropdown.createEl("option", { text: p.label });
		opt.value = p.value;
		if (p.value === presetValue) opt.selected = true;
	});
	const customOpt = dropdown.createEl("option", { text: "Custom (hex)" });
	customOpt.value = "custom";
	if (!isPreset) customOpt.selected = true;
	dropdown.addEventListener("change", () => {
		const v = dropdown.value;
		if (v === "custom") {
			(plugin.settings as unknown as Record<string, CanvasColor>)[key] = customHex.value.trim() || "#000000";
		} else {
			(plugin.settings as unknown as Record<string, CanvasColor>)[key] = v;
		}
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
			plugin.saveSettings();
		}
	});
	dropdown.addEventListener("change", () => {
		customHex.style.display = dropdown.value === "custom" ? "inline-block" : "none";
	});
}

export class ZettelSettingTab extends PluginSettingTab {
	plugin: ZettelThinkingBoardPlugin;

	constructor(app: App, plugin: ZettelThinkingBoardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Ollama model (Orange / primary LLM)")
			.setDesc("Model ID for orange nodes (e.g. llama2)")
			.addText((text) => text
				.setPlaceholder("e.g. llama2")
				.setValue(this.plugin.settings.ollamaOrangeModel)
				.onChange(async (value) => {
					this.plugin.settings.ollamaOrangeModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Ollama model (Purple / secondary LLM)")
			.setDesc("Model ID for purple nodes")
			.addText((text) => text
				.setPlaceholder("e.g. mistral")
				.setValue(this.plugin.settings.ollamaPurpleModel)
				.onChange(async (value) => {
					this.plugin.settings.ollamaPurpleModel = value;
					await this.plugin.saveSettings();
				}));

		addColorSetting(
			containerEl,
			this.plugin,
			"orange",
			"Color for Orange (primary LLM) nodes",
			"Canvas node color that maps to Orange behavior"
		);
		addColorSetting(
			containerEl,
			this.plugin,
			"purple",
			"Color for Purple (secondary LLM) nodes",
			"Canvas node color that maps to Purple behavior"
		);
		addColorSetting(
			containerEl,
			this.plugin,
			"blue",
			"Color for Blue (Python) nodes",
			"Canvas node color that maps to Blue behavior"
		);
		addColorSetting(
			containerEl,
			this.plugin,
			"yellow",
			"Color for Yellow (comment) nodes",
			"Canvas node color that maps to Yellow pass-through"
		);
		addColorSetting(
			containerEl,
			this.plugin,
			"green",
			"Color for Green (output) nodes",
			"Canvas node color used for auto-generated output nodes"
		);

		new Setting(containerEl)
			.setName("Python path")
			.setDesc("Path to Python executable for Blue nodes (e.g. python3 or /usr/bin/python3)")
			.addText((text) => text
				.setPlaceholder("python3")
				.setValue(this.plugin.settings.pythonPath)
				.onChange(async (value) => {
					this.plugin.settings.pythonPath = value || "python3";
					await this.plugin.saveSettings();
				}));
	}
}
