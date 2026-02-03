import {Menu, Notice, Plugin, WorkspaceLeaf} from "obsidian";
import {DEFAULT_SETTINGS, ZettelPluginSettings, ZettelSettingTab} from "./settings";
import {ZettelControlsView, ZETTEL_CONTROLS_VIEW_TYPE} from "./views/ZettelControlsView";
import {dismissOutput as runnerDismissOutput, runChain as runnerRunChain, runNode as runnerRunNode} from "./engine/runner";
import {getKernelForCanvas, terminateAllKernels, terminateKernel} from "./engine/kernelManager";
import {loadCanvasData} from "./canvas/nodes";

export default class ZettelThinkingBoardPlugin extends Plugin {
	settings: ZettelPluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ZettelSettingTab(this.app, this));

		this.registerView(
			ZETTEL_CONTROLS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new ZettelControlsView(leaf, this)
		);

		this.addCommand({
			id: "open-zettel-controls",
			name: "Open Zettel Controls",
			callback: () => this.activateZettelControls(),
		});

		this.addCommand({
			id: "run-node",
			name: "Run node",
			checkCallback: (checking: boolean) => {
				const view = this.getActiveCanvasView();
				if (!view) return false;
				if (checking) return true;
				// Command palette: no node selected; prompt user to use context menu
				new Notice("Right-click a node and choose \"Run node\" to run it.");
				return true;
			},
		});

		this.addCommand({
			id: "run-chain",
			name: "Run chain",
			checkCallback: (checking: boolean) => {
				const view = this.getActiveCanvasView();
				if (!view) return false;
				if (checking) return true;
				new Notice("Right-click a node and choose \"Run chain\" to run from roots.");
				return true;
			},
		});

		this.addCommand({
			id: "dismiss-output",
			name: "Dismiss output",
			checkCallback: (checking: boolean) => {
				const view = this.getActiveCanvasView();
				if (!view) return false;
				if (checking) return true;
				new Notice("Right-click a node and choose \"Dismiss output\" to remove its output.");
				return true;
			},
		});

		// Canvas node context menu: Run Node, Run Chain, Dismiss Output
		const onCanvasNodeMenu = this.app.workspace.on as (
			name: string,
			callback: (menu: Menu, node: { id?: string }) => void
		) => ReturnType<typeof this.app.workspace.on>;
		this.registerEvent(
			onCanvasNodeMenu("canvas:node-menu", (menu: Menu, node: { id?: string }) => {
				const nodeId = node?.id;
				if (!nodeId) return;
				menu.addItem((item) =>
					item.setTitle("Run node").setIcon("play").onClick(() => this.runNode(nodeId))
				);
				menu.addItem((item) =>
					item.setTitle("Run chain").setIcon("forward").onClick(() => this.runChain(nodeId))
				);
				menu.addItem((item) =>
					item.setTitle("Dismiss output").setIcon("trash").onClick(() => this.dismissOutput(nodeId))
				);
			})
		);

		// Terminate kernel when a canvas is closed (one kernel per canvas)
		let previousCanvasPaths = new Set<string>();
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const leaves = this.app.workspace.getLeavesOfType("canvas");
				const openPaths = new Set<string>();
				for (const leaf of leaves) {
					const v = leaf.view as { file?: { path: string } };
					if (v?.file?.path) openPaths.add(v.file.path);
				}
				for (const path of previousCanvasPaths) {
					if (!openPaths.has(path)) terminateKernel(path);
				}
				previousCanvasPaths = openPaths;
			})
		);
	}

	onunload() {
		terminateAllKernels();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ZettelPluginSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateZettelControls(): Promise<void> {
		const {workspace} = this.app;
		const leaves = workspace.getLeavesOfType(ZETTEL_CONTROLS_VIEW_TYPE);
		const existing = leaves[0];
		if (existing) {
			workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (leaf != null) {
			await leaf.setViewState({ type: ZETTEL_CONTROLS_VIEW_TYPE });
			workspace.revealLeaf(leaf);
		}
	}

	/** Returns the active canvas view if the active leaf is a canvas. */
	getActiveCanvasView(): { canvas: unknown; file: { path: string } } | null {
		const leaf = this.app.workspace.activeLeaf;
		if (!leaf?.view) return null;
		const v = leaf.view as { getViewType?: () => string; canvas?: unknown; file?: { path: string } };
		if (v.getViewType?.() !== "canvas") return null;
		if (v.canvas == null || v.file == null) return null;
		return { canvas: v.canvas, file: v.file };
	}

	/** Run a single node (call from context menu with node id). */
	async runNode(nodeId: string): Promise<void> {
		const view = this.getActiveCanvasView();
		if (!view) return;
		const liveCanvas = view.canvas as import("./engine/canvasApi").LiveCanvas;
		const result = await runnerRunNode(this.app, this.settings, view.file.path, nodeId, liveCanvas);
		if (!result.ok) new Notice(result.message ?? "Run node failed.");
	}

	/** Run chain from roots to the given node (call from context menu with node id). */
	async runChain(nodeId: string): Promise<void> {
		const view = this.getActiveCanvasView();
		if (!view) return;
		const liveCanvas = view.canvas as import("./engine/canvasApi").LiveCanvas;
		const result = await runnerRunChain(this.app, this.settings, view.file.path, nodeId, liveCanvas);
		if (!result.ok) new Notice(result.message ?? "Run chain failed.");
	}

	/** Dismiss the Green output node for the given source node (call from context menu with node id). */
	async dismissOutput(nodeId: string): Promise<void> {
		const view = this.getActiveCanvasView();
		if (!view) return;
		const data = await loadCanvasData(this.app.vault, view.file.path);
		if (!data) return;
		const liveCanvas = view.canvas as import("./engine/canvasApi").LiveCanvas;
		runnerDismissOutput(data, nodeId, this.settings, liveCanvas);
	}

	/** Get kernel for the active canvas (for side panel to wire obsidian_log). */
	getKernelForActiveCanvas(): import("./engine/pythonKernel").PythonKernel | null {
		const view = this.getActiveCanvasView();
		if (!view) return null;
		return getKernelForCanvas(view.file.path, this.settings.pythonPath);
	}
}
