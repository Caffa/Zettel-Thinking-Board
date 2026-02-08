import {App, Plugin, PluginSettingTab, Setting, Notice} from "obsidian";
import {fetchOllamaModels} from "./engine/ollama";
import {
	checkPythonInstallation,
	checkOllamaInstallation,
	checkModelInstalled,
	downloadOllamaModel,
	startOllamaService,
	getPythonInstallInstructions,
	getOllamaInstallInstructions,
	openInstallationPage,
	RECOMMENDED_MODELS,
	type RecommendedModel,
} from "./engine/installer";
import ntc from "ntcjs";

/** CanvasColor: Obsidian preset '1'..'6' or hex e.g. '#FFA500' */
export type CanvasColor = string;

/** Fixed hex color for output nodes (not from palette), so palette colors remain available for model mapping. */
export const OUTPUT_NODE_COLOR = "#03807D";

export type NodeRole = "red" | "orange" | "purple" | "blue" | "yellow" | "green" | "cyan" | "pink";

/** Default label for each role when no model name is set. */
export const ROLE_LABELS: Record<NodeRole, string> = {
	orange: "Model (primary)",
	purple: "Model (secondary)",
	red: "Model (tertiary)",
	cyan: "Model (4th)",
	pink: "Model (5th)",
	blue: "Python",
	yellow: "Text",
	green: "Output",
};

/** Model roles that use an Ollama model and support an optional custom label. */
const MODEL_ROLES: NodeRole[] = ["orange", "purple", "red", "cyan", "pink"];

/** All roles that have a configurable node color. Output (green) uses fixed OUTPUT_NODE_COLOR and is excluded. */
export const COLOR_ROLES: NodeRole[] = ["orange", "purple", "red", "cyan", "pink", "blue", "yellow"];

/** Human-readable names for conflict alerts (one-to-one color mapping). */
const ROLE_DISPLAY_NAMES: Record<NodeRole, string> = {
	orange: "Primary model",
	purple: "Secondary model",
	red: "Tertiary model",
	cyan: "4th model",
	pink: "5th model",
	blue: "Python node",
	yellow: "Text node",
	green: "Output node",
};

/** Returns another role that already uses this color value, or null if unique. Skips roles with empty (Disabled) color. */
function getOtherRoleWithColor(
	settings: ZettelPluginSettings,
	colorValue: string,
	excludeRole: NodeRole
): NodeRole | null {
	if (!colorValue) return null;
	for (const r of COLOR_ROLES) {
		if (r === excludeRole) continue;
		const key = `color${r.charAt(0).toUpperCase() + r.slice(1)}` as keyof ZettelPluginSettings;
		const roleColor = (settings[key] as string) ?? "";
		if (!roleColor.trim()) continue; // Disabled role: no conflict
		if (roleColor === colorValue) return r;
	}
	return null;
}

function getModelName(role: NodeRole, settings: ZettelPluginSettings): string {
	if (role === "orange") return (settings.ollamaOrangeModel || "").trim();
	if (role === "purple") return (settings.ollamaPurpleModel || "").trim();
	if (role === "red") return (settings.ollamaRedModel || "").trim();
	if (role === "cyan") return (settings.ollamaCyanModel || "").trim();
	if (role === "pink") return (settings.ollamaPinkModel || "").trim();
	return "";
}

function getModelLabel(role: NodeRole, settings: ZettelPluginSettings): string {
	if (role === "orange") return (settings.modelLabelOrange || "").trim();
	if (role === "purple") return (settings.modelLabelPurple || "").trim();
	if (role === "red") return (settings.modelLabelRed || "").trim();
	if (role === "cyan") return (settings.modelLabelCyan || "").trim();
	if (role === "pink") return (settings.modelLabelPink || "").trim();
	return "";
}

/** Display label for the canvas: uses model name for model roles; optional custom label is prepended (e.g. "quick: llama2"). */
export function getRoleLabel(role: NodeRole, settings: ZettelPluginSettings): string {
	if (MODEL_ROLES.includes(role)) {
		const name = getModelName(role, settings);
		const customLabel = getModelLabel(role, settings);
		if (name) {
			return customLabel ? `${customLabel}: ${name}` : `Model: ${name}`;
		}
		return customLabel ? `${customLabel}: (no model)` : ROLE_LABELS[role];
	}
	return ROLE_LABELS[role];
}

export interface ZettelPluginSettings {
	ollamaOrangeModel: string;
	ollamaPurpleModel: string;
	ollamaRedModel: string;
	ollamaCyanModel: string;
	ollamaPinkModel: string;
	modelLabelOrange: string;
	modelLabelPurple: string;
	modelLabelRed: string;
	modelLabelCyan: string;
	modelLabelPink: string;
	ollamaOrangeTemperature: number;
	ollamaPurpleTemperature: number;
	ollamaRedTemperature: number;
	ollamaCyanTemperature: number;
	ollamaPinkTemperature: number;
	colorRed: CanvasColor;
	colorOrange: CanvasColor;
	colorPurple: CanvasColor;
	colorCyan: CanvasColor;
	colorPink: CanvasColor;
	colorBlue: CanvasColor;
	colorYellow: CanvasColor;
	showPromptInOutput: boolean;
	showThinkingNode: boolean;
	showNodeRoleLabels: boolean;
	supportShorthandPlaceholders: boolean;
	pythonPath: string;
	/** Conda environment name. When set, Python is run via `conda run -n &lt;name&gt;`. */
	pythonCondaEnv: string;
	canvasTemplateFolder: string;
	canvasOutputFolder: string;
}

export const DEFAULT_SETTINGS: ZettelPluginSettings = {
	ollamaOrangeModel: "",
	ollamaPurpleModel: "",
	ollamaRedModel: "",
	ollamaCyanModel: "",
	ollamaPinkModel: "",
	modelLabelOrange: "",
	modelLabelPurple: "",
	modelLabelRed: "",
	modelLabelCyan: "",
	modelLabelPink: "",
	ollamaOrangeTemperature: 0.8,
	ollamaPurpleTemperature: 0.8,
	ollamaRedTemperature: 0.8,
	ollamaCyanTemperature: 0.8,
	ollamaPinkTemperature: 0.8,
	colorRed: "5",
	colorOrange: "1",
	colorPurple: "2",
	colorCyan: "4",
	colorPink: "",
	colorBlue: "6",
	colorYellow: "3",
	showPromptInOutput: false,
	showThinkingNode: false,
	showNodeRoleLabels: true,
	supportShorthandPlaceholders: true,
	pythonPath: "python3",
	pythonCondaEnv: "",
	canvasTemplateFolder: "",
	canvasOutputFolder: "",
};

/** Fallback hex for preset 1–6 to match Obsidian order (mod-canvas-color-N). */
const PRESET_HEX: Record<string, string> = {
	"1": "#ef4444",
	"2": "#e68619",
	"3": "#eab308",
	"4": "#22c55e",
	"5": "#a855f7",
	"6": "#3b82f6",
};

/** Normalize Advanced Canvas / Obsidian format: "r, g, b" -> "rgb(r,g,b)". */
function normalizeCanvasColorValue(value: string): string {
	const trimmed = value.trim();
	// Advanced Canvas uses --canvas-color-X: r, g, b (RGB triplets on body)
	if (/^\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(trimmed)) return `rgb(${trimmed})`;
	return trimmed;
}

/**
 * Resolve preset color: read --canvas-color-N from body (Advanced Canvas) then documentElement (Obsidian), else fallback hex.
 * Supports Advanced Canvas custom colors: https://github.com/Developer-Mike/obsidian-advanced-canvas#custom-colors
 */
export function getPresetColor(presetNumber: 1 | 2 | 3 | 4 | 5 | 6): string {
	const n = Math.max(1, Math.min(6, presetNumber));
	const varName = `--canvas-color-${n}`;
	// Prefer body so Advanced Canvas custom colors (set on body) are used when present
	const fromBody = getComputedStyle(document.body).getPropertyValue(varName).trim();
	const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
	const value = normalizeCanvasColorValue(fromBody || fromRoot);
	if (value && /^(#[0-9A-Fa-f]{3,8}|rgb\(|rgba\(|hsl\(|hsla\()/.test(value)) return value;
	return PRESET_HEX[String(n)] ?? "#888";
}


/**
 * Parse a color string (hex, rgb, rgba) and return RGB components.
 * Returns null if the color cannot be parsed.
 */
function parseColorToRGB(color: string): {r: number, g: number, b: number} | null {
	const trimmed = color.trim();

	// Handle hex colors (#RGB or #RRGGBB or #RRGGBBAA)
	if (trimmed.startsWith("#")) {
		const hex = trimmed.slice(1);
		let r = 0, g = 0, b = 0;

		if (hex.length === 3 && hex[0] && hex[1] && hex[2]) {
			// #RGB -> #RRGGBB
			r = parseInt(hex[0] + hex[0], 16);
			g = parseInt(hex[1] + hex[1], 16);
			b = parseInt(hex[2] + hex[2], 16);
		} else if (hex.length === 6 || hex.length === 8) {
			// #RRGGBB or #RRGGBBAA
			r = parseInt(hex.slice(0, 2), 16);
			g = parseInt(hex.slice(2, 4), 16);
			b = parseInt(hex.slice(4, 6), 16);
		} else {
			return null;
		}

		if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
			return {r, g, b};
		}
	}

	// Handle rgb(r, g, b) or rgba(r, g, b, a)
	const rgbMatch = trimmed.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
		return {
			r: parseInt(rgbMatch[1], 10),
			g: parseInt(rgbMatch[2], 10),
			b: parseInt(rgbMatch[3], 10)
		};
	}

	return null;
}

/**
 * Return a shade of the given color. amount in [-1, 1]: negative = darker (blend toward black), positive = lighter (blend toward white).
 * Accepts hex, rgb(), or Obsidian preset "1"-"6". Returns hex for Obsidian canvas node color; returns original string if parsing fails.
 */
export function shadeColor(color: string, amount: number): string {
	const resolved = /^[1-6]$/.test(color.trim()) ? getPresetColor(Number(color) as 1 | 2 | 3 | 4 | 5 | 6) : color;
	const rgb = parseColorToRGB(resolved);
	if (!rgb) return color;
	const t = Math.max(-1, Math.min(1, amount));
	const blend = (c: number) => {
		if (t >= 0) return Math.round(c + (255 - c) * t);
		return Math.round(c * (1 + t));
	};
	const r = blend(rgb.r);
	const g = blend(rgb.g);
	const b = blend(rgb.b);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Analyze a color and return a descriptive label using Name That Color (ntc.js).
 * Returns the human-readable color name from the extensive ntc color database.
 */
function analyzeColor(colorValue: string): string {
	const rgb = parseColorToRGB(colorValue);
	if (!rgb) {
		// If we can't parse it, return a default
		return "Red";
	}

	// Convert RGB to hex for ntc.js
	const hex = `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;

	// Use Name That Color library to get the color name
	// ntc.name() returns: [hex, name, exactMatch]
	const result = ntc.name(hex);

	// Return the color name (result[1])
	return result[1] || "Unknown";
}

/** Obsidian canvas preset 1–6: color label for settings dropdown (matches PRESET_HEX order). */
const PRESET_COLORS: { value: CanvasColor; label: string }[] = [
	{ value: "1", label: "Red" },
	{ value: "2", label: "Orange" },
	{ value: "3", label: "Yellow" },
	{ value: "4", label: "Green" },
	{ value: "5", label: "Purple" },
	{ value: "6", label: "Blue" },
];

const PRESET_SWATCH_CLASS = "ztb-color-swatch--preset-";

/** Role to human-readable block title for settings. */
const MODEL_BLOCK_TITLES: Record<"orange" | "purple" | "red" | "cyan" | "pink", string> = {
	orange: "Primary model",
	purple: "Secondary model",
	red: "Tertiary model",
	cyan: "4th model",
	pink: "5th model",
};

type ModelRole = "orange" | "purple" | "red" | "cyan" | "pink";

const MODEL_KEY_BY_ROLE: Record<ModelRole, keyof ZettelPluginSettings> = {
	orange: "ollamaOrangeModel",
	purple: "ollamaPurpleModel",
	red: "ollamaRedModel",
	cyan: "ollamaCyanModel",
	pink: "ollamaPinkModel",
};
const LABEL_KEY_BY_ROLE: Record<ModelRole, keyof ZettelPluginSettings> = {
	orange: "modelLabelOrange",
	purple: "modelLabelPurple",
	red: "modelLabelRed",
	cyan: "modelLabelCyan",
	pink: "modelLabelPink",
};
const TEMPERATURE_KEY_BY_ROLE: Record<ModelRole, keyof ZettelPluginSettings> = {
	orange: "ollamaOrangeTemperature",
	purple: "ollamaPurpleTemperature",
	red: "ollamaRedTemperature",
	cyan: "ollamaCyanTemperature",
	pink: "ollamaPinkTemperature",
};

/**
 * Build one collapsible model block: summary (e.g. "Primary model — llama2") and content (model picker, label, color).
 * Uses native <details> for accessible expand/collapse. Summary text updates when model or label changes.
 */
function addModelBlock(
	containerEl: HTMLElement,
	role: ModelRole,
	models: string[] | null,
	plugin: Plugin & { settings: ZettelPluginSettings; saveSettings(): Promise<void> },
	warningCallback?: (message: string | null) => void
): void {
	const s = plugin.settings;
	const title = MODEL_BLOCK_TITLES[role];
	const details = containerEl.createEl("details", { cls: "ztb-model-block" });
	// Primary expanded by default; others collapsed to reduce scroll
	details.open = role === "orange";

	const summary = details.createEl("summary", { cls: "ztb-model-block-summary" });
	const content = details.createDiv({ cls: "ztb-model-block-content" });

	const modelKey = MODEL_KEY_BY_ROLE[role];
	const labelKey = LABEL_KEY_BY_ROLE[role];
	const temperatureKey = TEMPERATURE_KEY_BY_ROLE[role];

	function updateSummaryText(): void {
		const name = (plugin.settings[modelKey] as string)?.trim() || "";
		const label = (plugin.settings[labelKey] as string)?.trim() || "";
		const part = label ? `${label}: ${name || "(no model)"}` : name || "(no model selected)";
		summary.setText(`${title} — ${part}`);
	}

	if (models && models.length > 0) {
		new Setting(content)
			.setName("Model")
			.setDesc("Ollama model used when you run this model node")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "— Select model —");
				for (const name of models) dropdown.addOption(name, name);
				const current = (s[modelKey] as string) || "";
				dropdown.setValue(current && models.includes(current) ? current : "");
				dropdown.onChange(async (value) => {
					(plugin.settings as unknown as Record<string, string>)[modelKey] = value;
					updateSummaryText();
					await plugin.saveSettings();
				});
			});
	} else {
		new Setting(content)
			.setName("Model")
			.setDesc("Ollama model name (e.g. llama2, mistral). Enter manually if Ollama is not reachable.")
			.addText((text) => text
				.setPlaceholder("e.g. llama2")
				.setValue((s[modelKey] as string) || "")
				.onChange(async (value) => {
					(plugin.settings as unknown as Record<string, string>)[modelKey] = value;
					updateSummaryText();
					await plugin.saveSettings();
				}));
	}

	new Setting(content)
		.setName("Label")
		.setDesc("Optional label on the canvas (e.g. quick, big); model name is shown after it")
		.addText((text) => text
			.setPlaceholder("e.g. quick")
			.setValue((s[labelKey] as string) || "")
			.onChange(async (value) => {
				(plugin.settings as unknown as Record<string, string>)[labelKey] = value;
				updateSummaryText();
				await plugin.saveSettings();
			}));

	const initialTemp = Number(s[temperatureKey]) ?? (DEFAULT_SETTINGS[temperatureKey] as number);
	let tempValueEl: HTMLSpanElement;
	const tempSetting = new Setting(content)
		.setName("Temperature")
		.setDesc("Higher = more creative, lower = more deterministic (0–2).")
		.addSlider((slider) => {
			slider
				.setLimits(0, 2, 0.1)
				.setValue(initialTemp)
				.onChange(async (value) => {
					(plugin.settings as unknown as Record<string, number>)[temperatureKey] = value;
					await plugin.saveSettings();
					tempValueEl.setText(value.toFixed(1));
				});
		});
	tempValueEl = tempSetting.controlEl.createSpan({ cls: "ztb-temperature-value", text: initialTemp.toFixed(1) });

	addColorSetting(
		content,
		plugin,
		role,
		"Color",
		"Node color on the canvas",
		warningCallback
	);

	updateSummaryText();
}

function setSwatchToPreset(swatch: HTMLElement, presetValue: string): void {
	for (let i = 1; i <= 6; i++) swatch.classList.remove(PRESET_SWATCH_CLASS + i);
	swatch.style.backgroundColor = getPresetColor(Number(presetValue) as 1 | 2 | 3 | 4 | 5 | 6);
}

function setSwatchToCustom(swatch: HTMLElement, hex: string): void {
	for (let i = 1; i <= 6; i++) swatch.classList.remove(PRESET_SWATCH_CLASS + i);
	swatch.style.backgroundColor = hex || "#888";
}

const COLOR_DISABLED_SENTINEL = "disabled";

function addColorSetting(
	containerEl: HTMLElement,
	plugin: Plugin & { settings: ZettelPluginSettings; saveSettings(): Promise<void> },
	role: NodeRole,
	label: string,
	desc: string,
	warningCallback?: (message: string | null) => void
): void {
	const key = `color${role.charAt(0).toUpperCase() + role.slice(1)}` as keyof ZettelPluginSettings;
	const current = (plugin.settings[key] as CanvasColor) ?? "";
	const isDisabled = !current || !String(current).trim();
	const isPreset = !isDisabled && /^[1-6]$/.test(current);
	const presetValue = isPreset ? current : "1";
	const customValue = isPreset ? "" : (isDisabled ? "" : current);

	const row = containerEl.createDiv({ cls: "setting-item" });
	const info = row.createDiv({ cls: "setting-item-info" });
	info.createEl("div", { cls: "setting-item-name", text: label });
	info.createEl("div", { cls: "setting-item-description", text: desc });
	const control = row.createDiv({ cls: "setting-item-control" });

	const swatchWrap = control.createSpan({ cls: "ztb-color-swatch-wrap" });
	const swatch = swatchWrap.createSpan({ cls: "ztb-color-swatch" });

	// Generate dynamic label for current preset based on actual color
	const getPresetLabel = (presetNum: string): string => {
		const actualColor = getPresetColor(Number(presetNum) as 1 | 2 | 3 | 4 | 5 | 6);
		return analyzeColor(actualColor);
	};

	if (isDisabled) {
		setSwatchToCustom(swatch, "#888");
		swatch.setAttr("title", "Disabled");
	} else if (isPreset) {
		setSwatchToPreset(swatch, presetValue);
		swatch.setAttr("title", getPresetLabel(presetValue));
	} else {
		setSwatchToCustom(swatch, customValue || "#888");
		swatch.setAttr("title", customValue || "Custom");
	}

	// Custom dropdown container
	const dropdownContainer = control.createDiv({ cls: "ztb-custom-dropdown-container" });
	const dropdownButton = dropdownContainer.createEl("button", {
		cls: "ztb-custom-dropdown-button",
		type: "button"
	});

	let currentValue: string = isDisabled ? COLOR_DISABLED_SENTINEL : (isPreset ? presetValue : "custom");

	const updateDropdownButton = () => {
		dropdownButton.empty();
		if (currentValue === COLOR_DISABLED_SENTINEL) {
			dropdownButton.setText("Disabled");
		} else if (currentValue === "custom") {
			dropdownButton.setText("Custom (hex)");
		} else {
			const actualColor = getPresetColor(Number(currentValue) as 1 | 2 | 3 | 4 | 5 | 6);
			const colorLabel = getPresetLabel(currentValue);
			const colorDot = dropdownButton.createSpan({ cls: "ztb-color-dot" });
			colorDot.style.backgroundColor = actualColor;
			dropdownButton.createSpan({ text: ` ${colorLabel}` });
		}
	};

	const dropdownMenu = dropdownContainer.createDiv({ cls: "ztb-custom-dropdown-menu" });
	dropdownMenu.style.display = "none";

	// Add Disabled option (first)
	const disabledOption = dropdownMenu.createDiv({ cls: "ztb-custom-dropdown-option" });
	if (currentValue === COLOR_DISABLED_SENTINEL) disabledOption.addClass("ztb-selected");
	disabledOption.setText("Disabled");
	disabledOption.addEventListener("click", () => {
		currentValue = COLOR_DISABLED_SENTINEL;
		(plugin.settings as unknown as Record<string, CanvasColor>)[key] = "";
		customHex.style.display = "none";
		dropdownMenu.querySelectorAll(".ztb-custom-dropdown-option").forEach(el => el.removeClass("ztb-selected"));
		disabledOption.addClass("ztb-selected");
		updateDropdownButton();
		setSwatchToCustom(swatch, "#888");
		swatch.setAttr("title", "Disabled");
		if (warningCallback) warningCallback(null);
		dropdownMenu.style.display = "none";
		plugin.saveSettings();
	});

	// Add preset color options
	PRESET_COLORS.forEach((p) => {
		const dynamicLabel = getPresetLabel(p.value);
		const actualColor = getPresetColor(Number(p.value) as 1 | 2 | 3 | 4 | 5 | 6);
		const option = dropdownMenu.createDiv({ cls: "ztb-custom-dropdown-option" });
		if (p.value === currentValue) option.addClass("ztb-selected");

		const colorDot = option.createSpan({ cls: "ztb-color-dot" });
		colorDot.style.backgroundColor = actualColor;
		option.createSpan({ text: ` ${dynamicLabel}` });

		option.addEventListener("click", () => {
			currentValue = p.value;
			(plugin.settings as unknown as Record<string, CanvasColor>)[key] = p.value;
			customHex.style.display = "none";
			dropdownMenu.querySelectorAll(".ztb-custom-dropdown-option").forEach(el => el.removeClass("ztb-selected"));
			option.addClass("ztb-selected");
			updateDropdownButton();
			setSwatchToPreset(swatch, p.value);
			swatch.setAttr("title", getPresetLabel(p.value));
			checkColorConflict(p.value);
			dropdownMenu.style.display = "none";
			plugin.saveSettings();
		});
	});

	// Add custom option
	const customOption = dropdownMenu.createDiv({ cls: "ztb-custom-dropdown-option" });
	if (currentValue === "custom") customOption.addClass("ztb-selected");
	customOption.setText("Custom (hex)");
	customOption.addEventListener("click", () => {
		currentValue = "custom";
		customHex.style.display = "inline-block";
		const hex = customHex.value.trim() || "#000000";
		(plugin.settings as unknown as Record<string, CanvasColor>)[key] = hex;
		dropdownMenu.querySelectorAll(".ztb-custom-dropdown-option").forEach(el => el.removeClass("ztb-selected"));
		customOption.addClass("ztb-selected");
		updateDropdownButton();
		setSwatchToCustom(swatch, hex);
		swatch.setAttr("title", hex);
		checkColorConflict(hex);
		dropdownMenu.style.display = "none";
		plugin.saveSettings();
	});

	// Toggle dropdown on button click
	dropdownButton.addEventListener("click", (e) => {
		e.stopPropagation();
		const isVisible = dropdownMenu.style.display !== "none";
		dropdownMenu.style.display = isVisible ? "none" : "block";
	});

	// Close dropdown when clicking outside
	document.addEventListener("click", () => {
		dropdownMenu.style.display = "none";
	});

	dropdownMenu.addEventListener("click", (e) => {
		e.stopPropagation();
	});

	updateDropdownButton();

	function checkColorConflict(newColorValue: string): void {
		const other = getOtherRoleWithColor(plugin.settings, newColorValue, role);
		if (other && warningCallback) {
			const otherName = ROLE_DISPLAY_NAMES[other];
			warningCallback(`⚠ This color is already used by "${otherName}". Each node type should have a unique color so nodes are easy to tell apart on the canvas.`);
		} else if (!other && warningCallback) {
			warningCallback(null);
		}
	}

	const customHex = control.createEl("input", {
		type: "text",
		cls: "ztb-color-hex",
		attr: { placeholder: "#RRGGBB" },
	});
	customHex.value = customValue;
	customHex.style.display = (isDisabled || isPreset) ? "none" : "inline-block";
	customHex.style.width = "6em";
	customHex.style.marginLeft = "6px";
	customHex.addEventListener("input", () => {
		const hex = customHex.value.trim();
		if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
			(plugin.settings as unknown as Record<string, CanvasColor>)[key] = hex;
			swatch.style.backgroundColor = hex;
			checkColorConflict(hex);
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

		/*
		 * UX philosophy for this tab:
		 * - Logical flow: Setup (dependencies) → Configuration (models, execution) → Display (appearance) → Templates (optional)
		 * - Progressive disclosure: auto-collapse setup when complete, collapsible model blocks
		 * - Clear hierarchy: sections → subsections → settings
		 * - Consistent spacing and grouping
		 */

		// Warning banner for color conflicts (hidden by default)
		const warningBanner = containerEl.createDiv({ cls: "ztb-color-warning-banner" });
		warningBanner.style.display = "none";
		warningBanner.style.backgroundColor = "var(--background-modifier-error)";
		warningBanner.style.color = "var(--text-on-accent)";
		warningBanner.style.padding = "12px 16px";
		warningBanner.style.marginBottom = "16px";
		warningBanner.style.borderRadius = "4px";
		warningBanner.style.border = "1px solid var(--background-modifier-error-border)";

		const warningCallback = (message: string | null) => {
			if (message) {
				warningBanner.setText(message);
				warningBanner.style.display = "block";
			} else {
				warningBanner.style.display = "none";
			}
		};

		// Installation & Dependencies section - auto-collapses when everything is installed
		this.addInstallationSection(containerEl);

		// Execution section: model configuration
		const executionSection = containerEl.createDiv({ cls: "ztb-settings-section" });
		executionSection.createEl("h4", { text: "Model Configuration", cls: "ztb-section-title" });
		const executionHint = executionSection.createDiv({ cls: "ztb-settings-hint setting-item-description" });
		executionHint.setText("Configure AI models and execution settings. Right-click a node on the canvas and choose Run node or Run chain to execute.");

		const ollamaContainer = executionSection.createDiv({ cls: "ztb-ollama-settings" });
		const loadingEl = ollamaContainer.createDiv({ cls: "ztb-ollama-loading" });
		loadingEl.setText("Loading Ollama models…");
		(async () => {
			const models = await fetchOllamaModels();
			loadingEl.remove();
			if (models.length === 0) {
				const fallback = ollamaContainer.createDiv({ cls: "ztb-ollama-fallback" });
				fallback.createEl("p", { text: "Ollama not reachable or no models installed. Enter model names manually or check Installation & Dependencies section above." });
			}
			// One collapsible block per model role: primary (expanded), others collapsed
			addModelBlock(ollamaContainer, "orange", models.length === 0 ? null : models, this.plugin, warningCallback);
			addModelBlock(ollamaContainer, "purple", models.length === 0 ? null : models, this.plugin, warningCallback);
			addModelBlock(ollamaContainer, "red", models.length === 0 ? null : models, this.plugin, warningCallback);
			addModelBlock(ollamaContainer, "cyan", models.length === 0 ? null : models, this.plugin, warningCallback);
			addModelBlock(ollamaContainer, "pink", models.length === 0 ? null : models, this.plugin, warningCallback);
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

		new Setting(executionSection)
			.setName("Conda environment")
			.setDesc("Optional: conda environment name. When set, Python runs via conda (e.g. myenv). Leave empty to use Python path directly.")
			.addText((text) => text
				.setPlaceholder("e.g. myenv")
				.setValue(s.pythonCondaEnv ?? "")
				.onChange(async (value) => {
					s.pythonCondaEnv = (value ?? "").trim();
					await this.plugin.saveSettings();
				}));

		// Display section: appearance settings
		const displaySection = containerEl.createDiv({ cls: "ztb-settings-section" });
		displaySection.createEl("h4", { text: "Display", cls: "ztb-section-title" });
		const displayHint = displaySection.createDiv({ cls: "ztb-settings-hint setting-item-description" });
		displayHint.setText("Configure how nodes appear on the canvas. Each node type should have a unique color. Uncolored or unused-color nodes are not part of the execution graph.");

		new Setting(displaySection)
			.setName("Show role labels on canvas")
			.setDesc("Show a floating label above each node (e.g. Model: llama2, Text, Python) based on its color")
			.addToggle((toggle) => toggle
				.setValue(s.showNodeRoleLabels)
				.onChange(async (value) => {
					this.plugin.settings.showNodeRoleLabels = value;
					await this.plugin.saveSettings();
				}));

		addColorSetting(
			displaySection,
			this.plugin,
			"blue",
			"Python node color",
			"Color for Python execution nodes on the canvas",
			warningCallback
		);
		addColorSetting(
			displaySection,
			this.plugin,
			"yellow",
			"Text node color",
			"Color for text (input) nodes: pass-through text, no AI processing",
			warningCallback
		);

		new Setting(displaySection)
			.setName("Show prompt in output")
			.setDesc("When enabled, create a separate node above the output showing the full prompt sent to the model (in a lighter shade of the output color)")
			.addToggle((toggle) => toggle
				.setValue(s.showPromptInOutput)
				.onChange(async (value) => {
					this.plugin.settings.showPromptInOutput = value;
					await this.plugin.saveSettings();
				}));

		new Setting(displaySection)
			.setName("Show model thinking node")
			.setDesc("When enabled and the model returns thinking (e.g. reasoning trace), create an extra node to display it")
			.addToggle((toggle) => toggle
				.setValue(s.showThinkingNode)
				.onChange(async (value) => {
					this.plugin.settings.showThinkingNode = value;
					await this.plugin.saveSettings();
				}));

		// Variables & placeholders subsection
		const variablesSubsection = displaySection.createDiv({ cls: "ztb-settings-subsection" });
		variablesSubsection.createEl("h5", { text: "Variables & placeholders", cls: "ztb-subsection-title" });
		new Setting(variablesSubsection)
			.setName("Support shorthand placeholders ({{name}})")
			.setDesc("When on, both {{var:name}} and {{name}} in card text are treated as inject placeholders (edge label = name). When off, only {{var:name}} is inject.")
			.addToggle((toggle) => toggle
				.setValue(s.supportShorthandPlaceholders)
				.onChange(async (value) => {
					this.plugin.settings.supportShorthandPlaceholders = value;
					await this.plugin.saveSettings();
				}));

		// Canvas Templates section
		const templatesSection = containerEl.createDiv({ cls: "ztb-settings-section" });
		templatesSection.createEl("h4", { text: "Canvas Templates", cls: "ztb-section-title" });
		const templatesHint = templatesSection.createDiv({ cls: "ztb-settings-hint setting-item-description" });
		templatesHint.setText("Define folders for canvas templates and where new canvases from templates should be created. Use the \"Duplicate canvas template\" command to create a new canvas from a template.");

		new Setting(templatesSection)
			.setName("Template folder")
			.setDesc("Folder containing canvas templates (e.g. Templates/Canvases). Leave empty to disable template feature.")
			.addText((text) => text
				.setPlaceholder("Templates/Canvases")
				.setValue(s.canvasTemplateFolder)
				.onChange(async (value) => {
					s.canvasTemplateFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(templatesSection)
			.setName("Output folder")
			.setDesc("Folder where new canvases from templates will be created (e.g. Canvases). Leave empty to create in vault root.")
			.addText((text) => text
				.setPlaceholder("Canvases")
				.setValue(s.canvasOutputFolder)
				.onChange(async (value) => {
					s.canvasOutputFolder = value;
					await this.plugin.saveSettings();
				}));
	}

	private addInstallationSection(containerEl: HTMLElement): void {
		const installSection = containerEl.createDiv({ cls: "ztb-settings-section" });

		// Create collapsible details element for the entire installation section
		const details = installSection.createEl("details", { cls: "ztb-install-section" });
		const summary = details.createEl("summary", { cls: "ztb-section-title-clickable" });
		summary.createEl("h4", { text: "Installation & Dependencies", cls: "ztb-section-title-inline" });

		const content = details.createDiv({ cls: "ztb-install-section-content" });

		const installHint = content.createDiv({ cls: "ztb-settings-hint setting-item-description" });
		installHint.setText("Ensure Python and Ollama are installed before using the plugin. Download recommended models for optimal performance.");

		// Python installation check
		const pythonContainer = content.createDiv({ cls: "ztb-install-check" });
		const pythonStatus = pythonContainer.createDiv({ cls: "ztb-install-status" });
		pythonStatus.setText("Checking Python installation...");

		new Setting(pythonContainer)
			.setName("Python")
			.setDesc("Required for Python nodes. Recommended: Python 3.8 or higher.")
			.addButton((button) => button
				.setButtonText("Check status")
				.onClick(async () => {
					button.setDisabled(true);
					const status = await checkPythonInstallation();
					if (status.installed) {
						pythonStatus.setText(`✓ Python installed: ${status.version || "Unknown version"}`);
						pythonStatus.style.color = "var(--text-success)";
					} else {
						pythonStatus.setText("✗ Python not found");
						pythonStatus.style.color = "var(--text-error)";
					}
					button.setDisabled(false);
				}))
			.addButton((button) => button
				.setButtonText("Install instructions")
				.onClick(() => {
					const instructions = getPythonInstallInstructions();
					new Notice(instructions, 10000);
					openInstallationPage("python");
				}));

		// Ollama installation check
		const ollamaContainer = content.createDiv({ cls: "ztb-install-check" });
		const ollamaStatus = ollamaContainer.createDiv({ cls: "ztb-install-status" });
		ollamaStatus.setText("Checking Ollama installation...");

		new Setting(ollamaContainer)
			.setName("Ollama")
			.setDesc("Required for AI model nodes. Provides local LLM inference.")
			.addButton((button) => button
				.setButtonText("Check status")
				.onClick(async () => {
					button.setDisabled(true);
					const status = await checkOllamaInstallation();
					if (status.installed && status.running) {
						ollamaStatus.setText(`✓ Ollama installed and running: ${status.version || "Unknown version"}`);
						ollamaStatus.style.color = "var(--text-success)";
					} else if (status.installed && !status.running) {
						ollamaStatus.setText(`⚠ Ollama installed but not running: ${status.version || "Unknown version"}`);
						ollamaStatus.style.color = "var(--text-warning)";
					} else {
						ollamaStatus.setText("✗ Ollama not found");
						ollamaStatus.style.color = "var(--text-error)";
					}
					button.setDisabled(false);
				}))
			.addButton((button) => button
				.setButtonText("Start service")
				.onClick(async () => {
					button.setDisabled(true);
					new Notice("Starting Ollama service...");
					const started = await startOllamaService();
					if (started) {
						ollamaStatus.setText("✓ Ollama service started");
						ollamaStatus.style.color = "var(--text-success)";
						new Notice("Ollama service started successfully");
					} else {
						new Notice("Failed to start Ollama service. Please start it manually.");
					}
					button.setDisabled(false);
				}))
			.addButton((button) => button
				.setButtonText("Install instructions")
				.onClick(() => {
					const instructions = getOllamaInstallInstructions();
					new Notice(instructions, 10000);
					openInstallationPage("ollama");
				}));

		// Recommended models subsection - also collapsible
		const modelsDetails = content.createEl("details", { cls: "ztb-models-subsection" });
		const modelsSummary = modelsDetails.createEl("summary", { cls: "ztb-subsection-summary" });
		modelsSummary.createEl("h5", { text: "Recommended Models", cls: "ztb-subsection-title-inline" });

		const modelsContent = modelsDetails.createDiv({ cls: "ztb-models-subsection-content" });
		const modelsHint = modelsContent.createDiv({ cls: "ztb-settings-hint setting-item-description" });
		modelsHint.setText("Download these models for optimal performance. Each model is optimized for different tasks.");

		// Store model status elements for auto-collapse check
		const modelStatusElements: { element: HTMLElement; modelName: string }[] = [];

		// Add each recommended model
		for (const model of RECOMMENDED_MODELS) {
			const statusElement = this.addModelDownloadSetting(modelsContent, model);
			modelStatusElements.push({ element: statusElement, modelName: model.name });
		}

		// Auto-check on load and determine if sections should be collapsed
		(async () => {
			const pythonCheck = await checkPythonInstallation();
			if (pythonCheck.installed) {
				pythonStatus.setText(`✓ Python installed: ${pythonCheck.version || "Unknown version"}`);
				pythonStatus.style.color = "var(--text-success)";
			} else {
				pythonStatus.setText("✗ Python not found. Click 'Install instructions' for help.");
				pythonStatus.style.color = "var(--text-error)";
			}

			const ollamaCheck = await checkOllamaInstallation();
			if (ollamaCheck.installed && ollamaCheck.running) {
				ollamaStatus.setText(`✓ Ollama installed and running: ${ollamaCheck.version || "Unknown version"}`);
				ollamaStatus.style.color = "var(--text-success)";
			} else if (ollamaCheck.installed && !ollamaCheck.running) {
				ollamaStatus.setText(`⚠ Ollama installed but not running. Click 'Start service' to start it.`);
				ollamaStatus.style.color = "var(--text-warning)";
			} else {
				ollamaStatus.setText("✗ Ollama not found. Click 'Install instructions' for help.");
				ollamaStatus.style.color = "var(--text-error)";
			}

			// Check if all dependencies are satisfied
			const pythonOk = pythonCheck.installed;
			const ollamaOk = ollamaCheck.installed && ollamaCheck.running;

			// Check if all recommended models are installed
			let allModelsInstalled = true;
			for (const { modelName } of modelStatusElements) {
				const installed = await checkModelInstalled(modelName);
				if (!installed) {
					allModelsInstalled = false;
					break;
				}
			}

			// Auto-collapse recommended models section if all are installed
			modelsDetails.open = !allModelsInstalled;

			// Update models summary to show status
			if (allModelsInstalled) {
				modelsSummary.setText("Recommended Models — All installed ✓");
			} else {
				modelsSummary.setText("Recommended Models — Some models need installation");
			}

			// Auto-collapse main installation section if Python + Ollama are ready
			// Keep it open if there are issues that need attention
			details.open = !(pythonOk && ollamaOk);

			// Update main summary to show overall status
			if (pythonOk && ollamaOk) {
				summary.setText("Installation & Dependencies — Ready ✓");
			} else if (pythonOk && !ollamaOk) {
				summary.setText("Installation & Dependencies — Ollama needs attention");
			} else if (!pythonOk && ollamaOk) {
				summary.setText("Installation & Dependencies — Python needs attention");
			} else {
				summary.setText("Installation & Dependencies — Setup required");
			}
		})();
	}

	private addModelDownloadSetting(containerEl: HTMLElement, model: RecommendedModel): HTMLElement {
		const modelContainer = containerEl.createDiv({ cls: "ztb-model-download" });
		const statusDiv = modelContainer.createDiv({ cls: "ztb-model-status" });
		statusDiv.setText("Checking...");

		const setting = new Setting(modelContainer)
			.setName(model.name)
			.setDesc(`${model.description} (${model.size})\n💡 ${model.useCase}`)
			.addButton((button) => button
				.setButtonText("Check")
				.onClick(async () => {
					button.setDisabled(true);
					const installed = await checkModelInstalled(model.name);
					if (installed) {
						statusDiv.setText("✓ Installed");
						statusDiv.style.color = "var(--text-success)";
					} else {
						statusDiv.setText("Not installed");
						statusDiv.style.color = "var(--text-muted)";
					}
					button.setDisabled(false);
				}))
			.addButton((button) => button
				.setButtonText("Download")
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("Downloading...");
					statusDiv.setText("Downloading... This may take several minutes.");
					statusDiv.style.color = "var(--text-accent)";

				const success = await downloadOllamaModel(model.name, (progress: string) => {
					// Update status with progress if needed
					statusDiv.setText(`Downloading... ${progress.trim().substring(0, 50)}`);
				});

					if (success) {
						statusDiv.setText("✓ Downloaded successfully");
						statusDiv.style.color = "var(--text-success)";
						button.setButtonText("Download");
					} else {
						statusDiv.setText("✗ Download failed");
						statusDiv.style.color = "var(--text-error)";
						button.setButtonText("Retry");
					}
					button.setDisabled(false);
				}));

		// Auto-check on load
		(async () => {
			const installed = await checkModelInstalled(model.name);
			if (installed) {
				statusDiv.setText("✓ Installed");
				statusDiv.style.color = "var(--text-success)";
			} else {
				statusDiv.setText("Not installed");
				statusDiv.style.color = "var(--text-muted)";
			}
		})();

		return statusDiv;
	}
}
