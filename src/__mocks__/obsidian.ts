/**
 * Minimal Obsidian API mock for unit tests. Exports stubs so plugin modules
 * (e.g. settings) that import from "obsidian" can load without the real app.
 */
export class Plugin {
	// stub
}

export class PluginSettingTab {
	// stub
}

export class Setting {
	// stub
}

export class Notice {
	// stub
}

export class Menu {
	// stub
}

export class ItemView {
	// stub
}

export const App = {};
export const WorkspaceLeaf = class {};
export const TFile = class {};
export const TAbstractFile = class {};
export const Vault = class {};
export const Workspace = class {};
export const MarkdownView = class {};
export const Editor = class {};
export const Modal = class {};
export const moment = () => ({});
