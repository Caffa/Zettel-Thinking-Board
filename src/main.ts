import {ItemView, Menu, Notice, Plugin, WorkspaceLeaf} from "obsidian";
import {DEFAULT_SETTINGS, ZettelPluginSettings, ZettelSettingTab} from "./settings";
import {ZettelControlsView, ZETTEL_CONTROLS_VIEW_TYPE} from "./views/ZettelControlsView";
import {
	dismissAllOutput as runnerDismissAllOutput,
	dismissOutput as runnerDismissOutput,
	runChain as runnerRunChain,
	runEntireCanvas as runnerRunEntireCanvas,
	runNode as runnerRunNode,
} from "./engine/runner";
import {
	clearCanvasEdgeModeLabels,
	clearCanvasLegend,
	clearCanvasRoleLabels,
	syncCanvasEdgeModeLabels,
	syncCanvasRoleLabels,
} from "./canvas/canvasNodeLabels";
import {getKernelForCanvas, terminateAllKernels, terminateKernel} from "./engine/kernelManager";

/** Resolve canvas node id from context-menu payload (shape may vary by Obsidian version). */
function resolveCanvasNodeId(node: unknown): string | undefined {
	if (!node || typeof node !== "object") return undefined;
	const n = node as Record<string, unknown>;
	if (typeof n.id === "string") return n.id;
	const inner = n.node as Record<string, unknown> | undefined;
	if (inner && typeof inner.id === "string") return inner.id;
	const data = typeof n.getData === "function" ? (n.getData as () => { id?: string })() : undefined;
	return data?.id;
}

/** Debug: set to true when canvas:node-menu callback has fired at least once (proves event is received). */
let debugNodeMenuFired = false;

export default class ZettelThinkingBoardPlugin extends Plugin {
	settings: ZettelPluginSettings;

	async onload() {
		try {
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

			// Canvas node context menu (event name is undocumented; try workspace.on("canvas:node-menu")).
			// Defer registration so Obsidian canvas is ready (avoids "reading '_'" in app.js).
			const addNodeMenuItems = (menu: Menu, node: unknown): void => {
				debugNodeMenuFired = true;
				const nodeId = resolveCanvasNodeId(node);
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
			};
			const registerCanvasNodeMenu = () => {
				try {
					const on = this.app.workspace.on.bind(this.app.workspace) as (
						name: string,
						callback: (menu: Menu, node: unknown) => void
					) => ReturnType<typeof this.app.workspace.on>;
					// Try documented-style event name first; some Obsidian builds use "canvas:node-menu".
					this.registerEvent(on("canvas:node-menu", addNodeMenuItems));
					// Fallback: try hyphenated name in case the app triggers a different event.
					this.registerEvent(on("canvas-node-menu", addNodeMenuItems));
				} catch (e) {
					console.error("Zettel Thinking Board: could not register canvas node menu.", e);
				}
			};
			const timeoutId = window.setTimeout(registerCanvasNodeMenu, 0);
			this.register(() => window.clearTimeout(timeoutId));

			// Canvas background context menu: use undocumented "canvas:edge-menu" (Obsidian broadcasts it;
			// when right-click is on empty area, edge is null). Same pattern as canvas:node-menu: addItem with setTitle, setIcon, onClick.
			const addCanvasMenuItems = (menu: Menu): void => {
				menu.addItem((item) =>
					item.setTitle("Run entire canvas").setIcon("play").onClick(() => this.runEntireCanvas())
				);
				menu.addItem((item) =>
					item.setTitle("Dismiss all output").setIcon("trash").onClick(() => this.dismissAllOutput())
				);
			};
			try {
				const onWorkspace = this.app.workspace.on.bind(this.app.workspace) as (
					name: string,
					callback: (menu: Menu, edge: unknown) => void
				) => ReturnType<typeof this.app.workspace.on>;
				this.registerEvent(
					onWorkspace("canvas:edge-menu", (menu: Menu, edge: unknown) => {
						if (edge == null) addCanvasMenuItems(menu);
					})
				);
			} catch (e) {
				console.error("Zettel Thinking Board: could not register canvas background menu.", e);
			}

			// Debug: command to test if we can affect the canvas and if canvas:node-menu ever fires.
			this.addCommand({
				id: "zettel-debug-canvas-hook",
				name: "Debug canvas hook",
				checkCallback: (checking: boolean) => {
					if (checking) return true;
					const canvasActive = this.getActiveCanvasView() != null;
					const msg =
						"Canvas active: " +
						(canvasActive ? "yes" : "no (focus a canvas first)") +
						". Node menu ever fired: " +
						(debugNodeMenuFired ? "yes" : "no (right-click a node to test).");
					new Notice(msg);
					return true;
				},
			});

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

			// Floating role labels on canvas: sync when active leaf is a canvas, clear when not
			let roleLabelsContainerEl: HTMLElement | null = null;
			let roleLabelsIntervalId: number | null = null;
			const runSyncLabels = (): void => {
				const view = this.getActiveCanvasView();
				if (!view) {
					if (roleLabelsIntervalId != null) {
						clearInterval(roleLabelsIntervalId);
						roleLabelsIntervalId = null;
						delete (this as unknown as Record<string, unknown>)._roleLabelsIntervalId;
					}
					if (roleLabelsContainerEl != null) {
						clearCanvasRoleLabels(roleLabelsContainerEl);
						clearCanvasLegend(roleLabelsContainerEl);
						clearCanvasEdgeModeLabels(roleLabelsContainerEl);
						this.clearCanvasToolbar(roleLabelsContainerEl);
						roleLabelsContainerEl = null;
					}
					return;
				}
				if (roleLabelsContainerEl != null && roleLabelsContainerEl !== view.containerEl) {
					clearCanvasRoleLabels(roleLabelsContainerEl);
					clearCanvasLegend(roleLabelsContainerEl);
					clearCanvasEdgeModeLabels(roleLabelsContainerEl);
					this.clearCanvasToolbar(roleLabelsContainerEl);
				}
				roleLabelsContainerEl = view.containerEl;
				// Add "Run entire canvas" and "Dismiss all output" to the canvas (title bar if supported, else toolbar in container).
				// Use a property on the view so we only add once even after plugin hot-reload (WeakSet would be cleared on reload).
				const leaf = this.app.workspace.activeLeaf;
				let addedToTitleBar = false;
				type ViewWithFlag = ItemView & { addAction?: (icon: string, title: string, callback: (evt: MouseEvent) => void) => HTMLElement; _ztbTitleBarActionsAdded?: boolean };
				if (leaf?.view) {
					const itemView = leaf.view as ViewWithFlag;
					if (itemView._ztbTitleBarActionsAdded) {
						addedToTitleBar = true;
					} else if (typeof itemView.addAction === "function") {
						itemView.addAction("play", "Run entire canvas", () => this.runEntireCanvas());
						itemView.addAction("trash", "Dismiss all output", () => this.dismissAllOutput());
						itemView._ztbTitleBarActionsAdded = true;
						addedToTitleBar = true;
					}
				}
				if (!addedToTitleBar) this.addCanvasToolbarToContainer(view.containerEl);
				const liveCanvas = view.canvas as import("./engine/canvasApi").LiveCanvas;
				const isStillActive = (): boolean => this.getActiveCanvasView()?.containerEl === roleLabelsContainerEl;
				syncCanvasRoleLabels(this.app.vault, view.file.path, view.containerEl, this.settings, liveCanvas, isStillActive);
				syncCanvasEdgeModeLabels(this.app.vault, view.file.path, view.containerEl, liveCanvas, isStillActive);
				if (roleLabelsIntervalId == null) {
					roleLabelsIntervalId = window.setInterval(() => {
						const v = this.getActiveCanvasView();
						if (v != null && v.containerEl === roleLabelsContainerEl) {
							const stillActive = (): boolean => this.getActiveCanvasView()?.containerEl === roleLabelsContainerEl;
							syncCanvasRoleLabels(this.app.vault, v.file.path, v.containerEl, this.settings, v.canvas as import("./engine/canvasApi").LiveCanvas, stillActive);
							syncCanvasEdgeModeLabels(this.app.vault, v.file.path, v.containerEl, v.canvas as import("./engine/canvasApi").LiveCanvas, stillActive);
						}
					}, 2000);
					(this as unknown as { _roleLabelsIntervalId: number })._roleLabelsIntervalId = roleLabelsIntervalId;
				}
			};
			this.registerEvent(this.app.workspace.on("active-leaf-change", runSyncLabels));
			runSyncLabels();
		} catch (e) {
			console.error("Zettel Thinking Board onload error:", e);
			throw e;
		}
	}

	onunload() {
		terminateAllKernels();
		const id = (this as unknown as { _roleLabelsIntervalId?: number })._roleLabelsIntervalId;
		if (id != null) clearInterval(id);
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
	getActiveCanvasView(): { canvas: unknown; file: { path: string }; containerEl: HTMLElement } | null {
		const leaf = this.app.workspace.activeLeaf;
		if (!leaf?.view) return null;
		const v = leaf.view as {
			getViewType?: () => string;
			canvas?: unknown;
			file?: { path: string };
			containerEl?: HTMLElement;
		};
		if (v.getViewType?.() !== "canvas") return null;
		if (v.canvas == null || v.file == null || !v.containerEl) return null;
		return { canvas: v.canvas, file: v.file, containerEl: v.containerEl };
	}

	/**
	 * Returns the active canvas view, or the first open canvas if the active leaf is not a canvas.
	 * Use this when the user may be focused on the control panel (e.g. Restart kernel button).
	 */
	getActiveOrFirstCanvasView(): { canvas: unknown; file: { path: string }; containerEl: HTMLElement } | null {
		const active = this.getActiveCanvasView();
		if (active) return active;
		const leaves = this.app.workspace.getLeavesOfType("canvas");
		const leaf = leaves[0];
		if (!leaf?.view) return null;
		const v = leaf.view as {
			getViewType?: () => string;
			canvas?: unknown;
			file?: { path: string };
			containerEl?: HTMLElement;
		};
		if (v.getViewType?.() !== "canvas") return null;
		if (v.canvas == null || v.file == null || !v.containerEl) return null;
		return { canvas: v.canvas, file: v.file, containerEl: v.containerEl };
	}

	private static readonly ZTB_TOOLBAR_CLASS = "ztb-canvas-toolbar";

	/** Remove the ZTB toolbar from the canvas container (when switching away or when addAction was used). */
	clearCanvasToolbar(containerEl: HTMLElement): void {
		containerEl.querySelectorAll(`.${ZettelThinkingBoardPlugin.ZTB_TOOLBAR_CLASS}`).forEach((el) => el.remove());
	}

	/** Add "Run entire canvas" and "Dismiss all output" buttons into the canvas container (fallback when view has no addAction). */
	addCanvasToolbarToContainer(containerEl: HTMLElement): void {
		if (containerEl.querySelector(`.${ZettelThinkingBoardPlugin.ZTB_TOOLBAR_CLASS}`)) return;
		const bar = containerEl.createDiv({ cls: ZettelThinkingBoardPlugin.ZTB_TOOLBAR_CLASS });
		const runBtn = bar.createEl("button", { cls: "ztb-toolbar-btn" });
		runBtn.setAttribute("aria-label", "Run entire canvas");
		runBtn.createSpan({ cls: "ztb-toolbar-icon", text: "▶" });
		runBtn.createSpan({ cls: "ztb-toolbar-label", text: "Run entire canvas" });
		runBtn.addEventListener("click", () => this.runEntireCanvas());
		const dismissBtn = bar.createEl("button", { cls: "ztb-toolbar-btn" });
		dismissBtn.setAttribute("aria-label", "Dismiss all output");
		dismissBtn.createSpan({ cls: "ztb-toolbar-icon", text: "🗑" });
		dismissBtn.createSpan({ cls: "ztb-toolbar-label", text: "Dismiss all output" });
		dismissBtn.addEventListener("click", () => this.dismissAllOutput());
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
		const liveCanvas = view.canvas as import("./engine/canvasApi").LiveCanvas;
		await runnerDismissOutput(this.app.vault, view.file.path, nodeId, this.settings, liveCanvas);
	}

	/** Run entire canvas (call from canvas background context menu). */
	async runEntireCanvas(): Promise<void> {
		const view = this.getActiveCanvasView();
		if (!view) return;
		const liveCanvas = view.canvas as import("./engine/canvasApi").LiveCanvas;
		const result = await runnerRunEntireCanvas(this.app, this.settings, view.file.path, liveCanvas);
		if (!result.ok) new Notice(result.message ?? "Run entire canvas failed.");
	}

	/** Dismiss all output nodes on the canvas (call from canvas background context menu). */
	async dismissAllOutput(): Promise<void> {
		const view = this.getActiveCanvasView();
		if (!view) return;
		const liveCanvas = view.canvas as import("./engine/canvasApi").LiveCanvas;
		await runnerDismissAllOutput(this.app.vault, view.file.path, liveCanvas);
	}

	/** Get kernel for the active (or first open) canvas (for side panel to wire obsidian_log). */
	getKernelForActiveCanvas(): import("./engine/pythonKernel").PythonKernel | null {
		const view = this.getActiveOrFirstCanvasView();
		if (!view) return null;
		return getKernelForCanvas(view.file.path, this.settings.pythonPath);
	}
}
