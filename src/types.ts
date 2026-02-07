import type {App} from "obsidian";
import type {ZettelPluginSettings} from "./settings";

/** Plugin interface used by views to avoid circular dependency on main. */
export interface IZettelThinkingBoardPlugin {
	app: App;
	settings: ZettelPluginSettings;
	saveSettings(): Promise<void>;
	getActiveCanvasView(): { canvas: unknown; file: { path: string } } | null;
	getActiveOrFirstCanvasView(): { canvas: unknown; file: { path: string } } | null;
	getKernelForActiveCanvas(): { onLog?: ((line: string) => void) | undefined; onError?: ((message: string) => void) | undefined; run(code: string, inputText: string): Promise<string>; terminate(): void } | null;
	registerEvent(ref: unknown): void;
}
