import {ItemView, Menu, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath} from "obsidian";
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
import {saveCanvasData} from "./canvas/nodes";
import type {CanvasData} from "./canvas/types";
import {EDGE_LABEL_OUTPUT} from "./canvas/types";
import {getKernelForCanvas, terminateAllKernels, terminateKernel} from "./engine/kernelManager";
import {getExample1CanvasData} from "./tutorials/example1Data";
import {getExample4CanvasData} from "./tutorials/example4Data";

/** Layout constants: comment margins left/right, central lane for nodes, no overlap. */
const TUT_LEFT = 80;
const TUT_TOP = 50;
const TUT_WELCOME_W = 420;
const TUT_WELCOME_H = 118;
const TUT_WELCOME_BOTTOM_GAP = 70;
/** Per-column: left comment margin | node lane | right comment margin. */
const TUT_COMMENT_W = 185;
const TUT_LANE_GAP = 22;
const TUT_NODE_LANE_W = 260;
const TUT_COL_TOTAL_W = TUT_COMMENT_W + TUT_LANE_GAP + TUT_NODE_LANE_W + TUT_LANE_GAP + TUT_COMMENT_W;
const TUT_COL_GAP = 85;
const TUT_NODE_H = 115;
const TUT_NODE_GAP = 58;
const TUT_LABEL_H = 88;
const TUT_GROUP_PAD = 18;

/** Resolve role color from settings (fallback to default so tutorial always has a valid color). */
function tutorialColor(settings: ZettelPluginSettings, key: keyof ZettelPluginSettings): string {
	const v = settings[key];
	return typeof v === "string" && v.trim() !== "" ? v.trim() : (DEFAULT_SETTINGS[key] as string);
}

/** X-offset for Example 4 (Data Pipeline) so it sits to the right of Example 1 (Multi-Source Research). */
const TUTORIAL_EXAMPLE4_X_OFFSET = 1400;
const TUTORIAL_EXAMPLE4_ID_PREFIX = "e4-";

/** Build combined tutorial canvas: Example 1 (left) and Example 4 (right) side by side. */
function getCombinedTutorialCanvasData(): CanvasData {
	const d1 = getExample1CanvasData();
	const d2 = getExample4CanvasData();
	const e4Nodes = d2.nodes.map((node) => ({
		...node,
		id: TUTORIAL_EXAMPLE4_ID_PREFIX + node.id,
		x: (node as { x: number }).x + TUTORIAL_EXAMPLE4_X_OFFSET,
	}));
	const e4Edges = d2.edges.map((edge, i) => ({
		...edge,
		id: `${TUTORIAL_EXAMPLE4_ID_PREFIX}edge-${i}`,
		fromNode: TUTORIAL_EXAMPLE4_ID_PREFIX + edge.fromNode,
		toNode: TUTORIAL_EXAMPLE4_ID_PREFIX + edge.toNode,
	}));
	return {
		nodes: [...d1.nodes, ...e4Nodes],
		edges: [...d1.edges, ...e4Edges],
	};
}

/** Build tutorial canvas: columns with comment margins, node lane center, edges, groups. */
function getTutorialCanvasData(settings: ZettelPluginSettings): CanvasData {
	const cOrange = tutorialColor(settings, "colorOrange");
	const cPurple = tutorialColor(settings, "colorPurple");
	const cBlue = tutorialColor(settings, "colorBlue");
	const cYellow = tutorialColor(settings, "colorYellow");
	const cGreen = tutorialColor(settings, "colorGreen");

	/** Plain text node (no role): use for labels/instructions so they are not treated as comment nodes. */
	const n = (id: string, text: string, x: number, y: number, color: string, w: number, h: number) =>
		({ id, type: "text" as const, text, x, y, width: w, height: h, color });
	const e = (id: string, from: string, to: string, label?: string) => ({
		id,
		fromNode: from,
		toNode: to,
		fromSide: "bottom" as const,
		toSide: "top" as const,
		label: label ?? "",
	});
	/** Group node to visually separate a workflow block. */
	const g = (id: string, x: number, y: number, w: number, h: number, label: string) =>
		({ id, type: "group" as const, x, y, width: w, height: h, label });

	/** Column 1..6: x of left comment margin (column 1 starts right after welcome). */
	const colLeft = (index: number) =>
		TUT_LEFT + TUT_WELCOME_W + TUT_COL_GAP + (index - 1) * (TUT_COL_TOTAL_W + TUT_COL_GAP);
	const commentLeftX = (colIndex: number) => colLeft(colIndex);
	/** Node lane: center x; offsetPx shifts right so alternating nodes make arrows more visible. */
	const laneNodeX = (colIndex: number, offsetPx: number = 0) =>
		colLeft(colIndex) + TUT_COMMENT_W + TUT_LANE_GAP + offsetPx;
	const commentRightX = (colIndex: number) =>
		colLeft(colIndex) + TUT_COMMENT_W + TUT_LANE_GAP + TUT_NODE_LANE_W + TUT_LANE_GAP;
	const LANE_OFFSET = 36;

	// —— Welcome: alone in first block, no overlap with column 1 ——
	const welcome = "welcome";
	const welcomeY = TUT_TOP;

	// —— Column 1: Primary (comment left, node → output in lane) ——
	const col1 = 1;
	const lab1 = "lab-primary";
	const orangeNode = "orange-example";
	const orangeOut = "orange-out";
	let y1 = TUT_TOP + TUT_WELCOME_H + TUT_WELCOME_BOTTOM_GAP;
	const orangeY = y1;
	y1 += TUT_NODE_H + TUT_NODE_GAP;
	const orangeOutY = y1;

	// —— Column 2: Purple, Yellow, Blue (comments in margins, nodes in lane) ——
	const col2 = 2;
	const lab2a = "lab-purple";
	const purpleNode = "purple-example";
	const purpleOut = "purple-out";
	const lab2b = "lab-yellow";
	const yellowNode = "yellow-example";
	const lab2c = "lab-blue";
	const blueNode = "blue-example";
	const blueOut = "blue-out";
	let y2 = TUT_TOP + TUT_WELCOME_H + TUT_WELCOME_BOTTOM_GAP;
	const purpleY = y2;
	y2 += TUT_NODE_H + TUT_NODE_GAP;
	const purpleOutY = y2;
	y2 += TUT_NODE_H + TUT_NODE_GAP + 20;
	const yellowY = y2;
	y2 += TUT_NODE_H + TUT_NODE_GAP + 20;
	const blueY = y2;
	y2 += TUT_NODE_H + TUT_NODE_GAP;
	const blueOutY = y2;

	// —— Column 3: Concatenation ——
	const col3 = 3;
	const lab3 = "lab-concat";
	const concatComment = "concat-comment";
	const concatOrange = "concat-orange";
	const concatOut = "concat-out";
	let y3 = TUT_TOP + TUT_WELCOME_H + TUT_WELCOME_BOTTOM_GAP;
	const concatCommentY = y3;
	y3 += TUT_NODE_H + TUT_NODE_GAP;
	const concatOrangeY = y3;
	y3 += TUT_NODE_H + TUT_NODE_GAP;
	const concatOutY = y3;

	// —— Column 4: Variable injection ——
	const col4 = 4;
	const lab4 = "lab-inject";
	const injectFirst = "inject-first";
	const injectSecond = "inject-second";
	const injectOut = "inject-out";
	let y4 = TUT_TOP + TUT_WELCOME_H + TUT_WELCOME_BOTTOM_GAP;
	const injectFirstY = y4;
	y4 += TUT_NODE_H + TUT_NODE_GAP;
	const injectSecondY = y4;
	y4 += TUT_NODE_H + TUT_NODE_GAP;
	const injectOutY = y4;

	// —— Column 5 & 6: Comments only (left margin + optional right), no nodes in lane ——
	const col5 = 5;
	const col6 = 6;
	const lab5 = "lab-commands";
	const lab6 = "lab-sidebar";
	const y5 = TUT_TOP + TUT_WELCOME_H + TUT_WELCOME_BOTTOM_GAP;
	const y6 = TUT_TOP + TUT_WELCOME_H + TUT_WELCOME_BOTTOM_GAP;

	// Group bounds (x, y, w, h) for each workflow block
	const TUT_WELCOME_CARD_H = 132;
	const groupWelcome = g(
		"grp-welcome",
		TUT_LEFT - TUT_GROUP_PAD,
		welcomeY - TUT_GROUP_PAD,
		TUT_WELCOME_W + 2 * TUT_GROUP_PAD,
		TUT_WELCOME_CARD_H + 2 * TUT_GROUP_PAD,
		"Welcome"
	);
	const groupCol1 = g(
		"grp-col1",
		commentLeftX(col1) - TUT_GROUP_PAD,
		orangeY - TUT_GROUP_PAD,
		TUT_COL_TOTAL_W + 2 * TUT_GROUP_PAD,
		orangeOutY + TUT_NODE_H - orangeY + 2 * TUT_GROUP_PAD,
		"Primary model"
	);
	const groupCol2 = g(
		"grp-col2",
		commentLeftX(col2) - TUT_GROUP_PAD,
		purpleY - TUT_GROUP_PAD,
		TUT_COL_TOTAL_W + 2 * TUT_GROUP_PAD,
		blueOutY + TUT_NODE_H - purpleY + 2 * TUT_GROUP_PAD,
		"Node types"
	);
	const groupCol3 = g(
		"grp-col3",
		commentLeftX(col3) - TUT_GROUP_PAD,
		concatCommentY - TUT_GROUP_PAD,
		TUT_COL_TOTAL_W + 2 * TUT_GROUP_PAD,
		concatOutY + TUT_NODE_H - concatCommentY + 2 * TUT_GROUP_PAD,
		"Concatenation"
	);
	const groupCol4 = g(
		"grp-col4",
		commentLeftX(col4) - TUT_GROUP_PAD,
		injectFirstY - TUT_GROUP_PAD,
		TUT_COL_TOTAL_W + 2 * TUT_GROUP_PAD,
		injectOutY + TUT_NODE_H - injectFirstY + 2 * TUT_GROUP_PAD,
		"Variable injection"
	);
	const groupCol5 = g(
		"grp-col5",
		commentLeftX(col5) - TUT_GROUP_PAD,
		y5 - TUT_GROUP_PAD,
		TUT_COL_TOTAL_W + 2 * TUT_GROUP_PAD,
		195 + 2 * TUT_GROUP_PAD,
		"How to run"
	);
	const groupCol6 = g(
		"grp-col6",
		commentLeftX(col6) - TUT_GROUP_PAD,
		y6 - TUT_GROUP_PAD,
		TUT_COL_TOTAL_W + 2 * TUT_GROUP_PAD,
		145 + 2 * TUT_GROUP_PAD,
		"Sidebar"
	);

	const nodes: CanvasData["nodes"] = [
		// Groups first (render behind)
		groupWelcome,
		groupCol1,
		groupCol2,
		groupCol3,
		groupCol4,
		groupCol5,
		groupCol6,
		// Welcome: plain text (no color = no role; not connected, does not add to prompt)
		n(welcome, "Welcome to Zettel Thinking Board. Each column is a separate showcase. Nodes run top to bottom. Right-click a card → Run node or Run chain. Uncolored or unused-color cards are not connected to any node and do not add to the prompt.", TUT_LEFT, welcomeY, "", TUT_WELCOME_W, 132),

		// Column 1: label = plain text; nodes in lane have roles
		n(lab1, "Primary model: sends prompt to Ollama. Set the model in Zettel Controls.", commentLeftX(col1), orangeY, "", TUT_COMMENT_W, TUT_LABEL_H),
		n(orangeNode, "What is 2+2? Reply in one sentence.", laneNodeX(col1, 0), orangeY, cOrange, TUT_NODE_LANE_W, TUT_NODE_H),
		n(orangeOut, "", laneNodeX(col1, LANE_OFFSET), orangeOutY, cGreen, TUT_NODE_LANE_W, TUT_NODE_H),

		// Column 2
		n(lab2a, "Secondary model (same idea, different model).", commentLeftX(col2), purpleY, "", TUT_COMMENT_W, TUT_LABEL_H),
		n(purpleNode, "Summarize in 5 words: The quick brown fox jumps.", laneNodeX(col2, 0), purpleY, cPurple, TUT_NODE_LANE_W, TUT_NODE_H),
		n(purpleOut, "", laneNodeX(col2, LANE_OFFSET), purpleOutY, cGreen, TUT_NODE_LANE_W, TUT_NODE_H),
		n(lab2b, "Text: input text; passed to next node as-is (pass-through).", commentRightX(col2), yellowY, "", TUT_COMMENT_W, TUT_LABEL_H),
		n(yellowNode, "I'm input text. My text is passed to the next node (concatenated).", laneNodeX(col2, 0), yellowY, cYellow, TUT_NODE_LANE_W, TUT_NODE_H),
		n(lab2c, "Python: runs code. Use variable input for parent text.", commentLeftX(col2), blueY, "", TUT_COMMENT_W, TUT_LABEL_H),
		n(blueNode, "print('Python says:', (input or '')[:80] or '(no input)')\n# input = text from parent", laneNodeX(col2, LANE_OFFSET), blueY, cBlue, TUT_NODE_LANE_W, TUT_NODE_H),
		n(blueOut, "", laneNodeX(col2, 0), blueOutY, cGreen, TUT_NODE_LANE_W, TUT_NODE_H),

		// Column 3
		n(lab3, "Concatenation: no edge label → parent output appended before your prompt (then \"---\", then this card).", commentLeftX(col3), concatCommentY, "", TUT_COMMENT_W, TUT_LABEL_H + 12),
		n(concatComment, "I'm input text. My full text is added to the next node's prompt.", laneNodeX(col3, 0), concatCommentY, cYellow, TUT_NODE_LANE_W, TUT_NODE_H),
		n(concatOrange, "Reply in one word: what did the previous card say?", laneNodeX(col3, LANE_OFFSET), concatOrangeY, cOrange, TUT_NODE_LANE_W, TUT_NODE_H),
		n(concatOut, "", laneNodeX(col3, 0), concatOutY, cGreen, TUT_NODE_LANE_W, TUT_NODE_H),

		// Column 4
		n(lab4, "Variable injection: put a name on the edge and use {{var:name}} in the prompt; that parent is injected there.", commentLeftX(col4), injectFirstY, "", TUT_COMMENT_W, TUT_LABEL_H + 12),
		n(injectFirst, "Say exactly: Hello world.", laneNodeX(col4, 0), injectFirstY, cOrange, TUT_NODE_LANE_W, TUT_NODE_H),
		n(injectSecond, "They said: {{var:reply}}. Confirm in 2 words.", laneNodeX(col4, LANE_OFFSET), injectSecondY, cOrange, TUT_NODE_LANE_W, TUT_NODE_H),
		n(injectOut, "", laneNodeX(col4, 0), injectOutY, cGreen, TUT_NODE_LANE_W, TUT_NODE_H),

		// Column 5 & 6: plain text labels only
		n(lab5, "How to run: Right-click a node → Run node or Run chain. Right-click empty canvas → Run entire canvas or Dismiss all output. Title bar: ▶ Run entire canvas, 🗑 Dismiss all. Commands: Open Zettel Controls; Create tutorial canvas.", commentLeftX(col5), y5, "", TUT_COMMENT_W + TUT_LANE_GAP + TUT_NODE_LANE_W, 195),
		n(lab6, "Sidebar: Open Zettel Controls. There: pick Ollama models and Temperature; restart Python kernel; env vars; Console (obsidian_log in Python cards).", commentLeftX(col6), y6, "", TUT_COMMENT_W + TUT_LANE_GAP + TUT_NODE_LANE_W, 145),
	];

	const edges: CanvasData["edges"] = [
		e("e-orange-out", orangeNode, orangeOut, EDGE_LABEL_OUTPUT),
		e("e-purple-out", purpleNode, purpleOut, EDGE_LABEL_OUTPUT),
		e("e-blue-out", blueNode, blueOut, EDGE_LABEL_OUTPUT),
		e("e-concat-comment-orange", concatComment, concatOrange),
		e("e-concat-out", concatOrange, concatOut, EDGE_LABEL_OUTPUT),
		e("e-inject-first-second", injectFirst, injectSecond, "reply"),
		e("e-inject-out", injectSecond, injectOut, EDGE_LABEL_OUTPUT),
	];

	return { nodes, edges };
}

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
				id: "create-tutorial-canvas",
				name: "Create tutorial canvas",
				callback: () => this.createTutorialCanvas(),
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

	/** Create a new tutorial canvas file in the vault and open it. */
	async createTutorialCanvas(): Promise<void> {
		const {vault, workspace} = this.app;
		const baseName = "Tutorial canvas";
		let n = 0;
		let path = normalizePath(`${baseName}.canvas`);
		while (vault.getAbstractFileByPath(path) != null) {
			n += 1;
			path = normalizePath(`${baseName} ${n}.canvas`);
		}
		const data = getCombinedTutorialCanvasData();
		const saved = await saveCanvasData(vault, path, data);
		if (!saved) {
			new Notice("Could not create tutorial canvas.");
			return;
		}
		const file = vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await workspace.getLeaf().openFile(file);
		} else {
			await workspace.openLinkText(path, "", false);
		}
		new Notice("Tutorial canvas created. Left: Multi-Source Research (concatenation). Right: Data Pipeline (Python state). Right-click a node → Run node or Run chain.");
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
