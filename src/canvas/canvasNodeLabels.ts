import type {Vault} from "obsidian";
import {loadCanvasData} from "./nodes";
import {getNodeRole, isOutputEdge} from "./types";
import type {CanvasColor, NodeRole, ZettelPluginSettings} from "../settings";
import {COLOR_ROLES, getPresetColor, getRoleLabel} from "../settings";
import type {LiveCanvas} from "../engine/canvasApi";
import {getTopologicalOrder} from "../engine/runner";
import {getCanvasKey, getEdgeMode, getRunningNodeId} from "../engine/state";

const LABEL_CLASS = "ztb-node-role-label";
const ORDER_BADGE_CLASS = "ztb-node-order-badge";
const LABEL_DATA_ATTR = "data-ztb-role-label";
const LEGEND_CLASS = "ztb-canvas-legend";
const EDGE_MODE_LABEL_CLASS = "ztb-edge-mode-label";
const EDGE_MODE_DATA_ATTR = "data-ztb-edge-id";
const EDGE_MODE_STATE_ATTR = "data-ztb-edge-state";
const EDGE_MODE_ICON_CLASS = "ztb-edge-mode-icon";
type EdgeDisplayState = "running" | "inject" | "concatenate";
/** Try to get a canvas node's root DOM element from the live canvas (Obsidian uses .canvas-node, no data-id). */
function getNodeElFromCanvas(canvas: LiveCanvas, nodeId: string): HTMLElement | null {
	const nodes = canvas.nodes;
	if (!nodes) return null;
	let view: {
		id?: string;
		nodeEl?: HTMLElement;
		el?: HTMLElement;
		wrapperEl?: HTMLElement;
		containerEl?: HTMLElement;
	} | undefined;
	if (nodes instanceof Map) {
		view = nodes.get(nodeId) as typeof view;
	} else {
		for (const n of nodes as Iterable<typeof view>) {
			if (n?.id === nodeId) {
				view = n;
				break;
			}
		}
	}
	if (!view) return null;
	// Obsidian canvas node view exposes the .canvas-node root via one of these
	if (view.nodeEl instanceof HTMLElement) return view.nodeEl;
	if (view.el instanceof HTMLElement) return view.el;
	if (view.wrapperEl instanceof HTMLElement) return view.wrapperEl;
	if (view.containerEl instanceof HTMLElement) return view.containerEl;
	if (view instanceof HTMLElement) return view;
	return null;
}

/** Fallback: find node by data-id if present (some builds may use it). */
function findNodeElementByDataId(containerEl: HTMLElement, nodeId: string): HTMLElement | null {
	const el = containerEl.querySelector(`.canvas-node[data-id="${nodeId}"], [data-id="${nodeId}"]`);
	return el instanceof HTMLElement ? el : null;
}

/** Remove all role labels and order badges we added from the container. */
export function clearCanvasRoleLabels(containerEl: HTMLElement): void {
	containerEl.querySelectorAll(`.${LABEL_CLASS}`).forEach((el) => el.remove());
	containerEl.querySelectorAll(`.${ORDER_BADGE_CLASS}`).forEach((el) => el.remove());
}

/** Remove the canvas legend from the container. */
export function clearCanvasLegend(containerEl: HTMLElement): void {
	containerEl.querySelectorAll(`.${LEGEND_CLASS}`).forEach((el) => el.remove());
}

const EDGE_MODE_FOREIGN_CLASS = "ztb-edge-mode-foreign";
const EDGE_MODE_SVG_LABEL_CLASS = "ztb-edge-mode-svg-label";
const OUTPUT_EDGE_GROUP_CLASS = "ztb-output-edge";

/** Remove all floating edge mode labels and output-edge styling from the container. */
export function clearCanvasEdgeModeLabels(containerEl: HTMLElement): void {
	containerEl.querySelectorAll(`.${EDGE_MODE_SVG_LABEL_CLASS}`).forEach((el) => el.remove());
	containerEl.querySelectorAll(`.${EDGE_MODE_FOREIGN_CLASS}`).forEach((el) => el.remove());
	containerEl.querySelectorAll(`.${EDGE_MODE_LABEL_CLASS}`).forEach((el) => el.remove());
	containerEl.querySelectorAll(`.${OUTPUT_EDGE_GROUP_CLASS}`).forEach((el) => el.classList.remove(OUTPUT_EDGE_GROUP_CLASS));
}

/** Create a small color swatch for the legend (preset: resolve var or fallback; custom: hex). */
function createLegendSwatch(color: CanvasColor): HTMLElement {
	const swatch = document.createElement("span");
	swatch.setAttribute("class", "ztb-legend-swatch");
	const isPreset = /^[1-6]$/.test(color);
	if (isPreset) {
		swatch.style.backgroundColor = getPresetColor(Number(color) as 1 | 2 | 3 | 4 | 5 | 6);
	} else {
		swatch.style.backgroundColor = (color || "#888").trim();
	}
	return swatch;
}

/** Build and append the legend to the canvas container (vanilla DOM, no innerHTML). Order: primary → tertiary, then Python, Text, Output. */
function syncCanvasLegend(containerEl: HTMLElement, settings: ZettelPluginSettings): void {
	clearCanvasLegend(containerEl);
	if (!settings.showNodeRoleLabels) return;
	const legend = document.createElement("div");
	legend.setAttribute("class", LEGEND_CLASS);
	const title = document.createElement("div");
	title.setAttribute("class", "ztb-legend-title");
	title.textContent = "Legend";
	legend.appendChild(title);
	for (const role of COLOR_ROLES) {
		const key = `color${role.charAt(0).toUpperCase() + role.slice(1)}` as keyof ZettelPluginSettings;
		const color = (settings[key] as CanvasColor) ?? "";
		const row = document.createElement("div");
		row.setAttribute("class", "ztb-legend-row");
		row.appendChild(createLegendSwatch(color));
		const text = document.createElement("span");
		text.setAttribute("class", "ztb-legend-text");
		text.textContent = getRoleLabel(role, settings);
		row.appendChild(text);
		legend.appendChild(row);
	}
	const otherRow = document.createElement("div");
	otherRow.setAttribute("class", "ztb-legend-row");
	const otherSwatch = document.createElement("span");
	otherSwatch.setAttribute("class", "ztb-legend-swatch ztb-legend-swatch--other");
	otherSwatch.style.backgroundColor = "var(--text-muted)";
	otherRow.appendChild(otherSwatch);
	const otherText = document.createElement("span");
	otherText.setAttribute("class", "ztb-legend-text");
	otherText.textContent = "Uncolored / unused color = not connected; does not add to prompt.";
	otherRow.appendChild(otherText);
	legend.appendChild(otherRow);
	containerEl.appendChild(legend);
}

/** Create a label element using Obsidian's canvas-node-label class (same as file nodes). */
function createLabelEl(text: string): HTMLElement {
	const el = document.createElement("div");
	el.setAttribute("class", `${LABEL_CLASS} canvas-node-label`);
	el.setAttribute(LABEL_DATA_ATTR, "1");
	el.style.pointerEvents = "none"; // ensure label never blocks node drag even if CSS is overridden
	el.textContent = text;
	return el;
}

/** Create the concatenation-order badge (top-right of node). Number is 1-based; top of order = 1. */
function createOrderBadgeEl(orderIndex: number): HTMLElement {
	const el = document.createElement("div");
	el.setAttribute("class", ORDER_BADGE_CLASS);
	el.style.pointerEvents = "none";
	el.textContent = String(orderIndex);
	return el;
}

/**
 * Sync floating role labels for the active canvas: for each node whose color maps to a role,
 * add a small label above the node (e.g. "Text", "Python"). Removes existing labels first.
 * Uses the live canvas node map to find each node's DOM element (.canvas-node).
 * @param isStillActive - if provided, called after async load; when false we skip applying to avoid stale canvas
 */
export async function syncCanvasRoleLabels(
	vault: Vault,
	canvasFilePath: string,
	containerEl: HTMLElement,
	settings: ZettelPluginSettings,
	canvas: LiveCanvas | null,
	isStillActive?: () => boolean
): Promise<void> {
	if (!settings.showNodeRoleLabels) {
		clearCanvasRoleLabels(containerEl);
		clearCanvasLegend(containerEl);
		return;
	}
	const data = await loadCanvasData(vault, canvasFilePath);
	if (isStillActive && !isStillActive()) return;
	if (!data?.nodes) {
		clearCanvasRoleLabels(containerEl);
		clearCanvasLegend(containerEl);
		return;
	}
	// Clear only after we have data so we never paint a frame with labels removed and nothing to show (avoids flicker).
	clearCanvasRoleLabels(containerEl);
	syncCanvasLegend(containerEl, settings);

	const order = getTopologicalOrder(data, settings);
	const orderByNodeId = new Map<string, number>();
	if (order) {
		order.forEach((nodeId, index) => orderByNodeId.set(nodeId, index + 1));
	}

	// #region agent log
	let sampleCount = 0;
	const maxSample = 3;
	// #endregion

	for (const node of data.nodes) {
		const nodeEl =
			(canvas && getNodeElFromCanvas(canvas, node.id)) ||
			findNodeElementByDataId(containerEl, node.id);
		if (!nodeEl) continue;

		// #region agent log
		if (sampleCount < maxSample) {
			const rect = nodeEl.getBoundingClientRect();
			const cs = nodeEl instanceof HTMLElement ? window.getComputedStyle(nodeEl) : null;
			const parentCs = nodeEl.parentElement ? window.getComputedStyle(nodeEl.parentElement) : null;
			fetch("http://127.0.0.1:7243/ingest/453147b6-6b57-40b4-a769-82c9dd3c5ee7", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					location: "canvasNodeLabels.ts:syncCanvasRoleLabels",
					message: "Node data vs DOM position",
					data: {
						hypothesisId: "H1_H2_H4",
						nodeId: node.id,
						dataXY: { x: (node as { x?: number }).x, y: (node as { y?: number }).y },
						dataWH: { w: (node as { width?: number }).width, h: (node as { height?: number }).height },
						domRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
						nodePosition: cs?.position ?? null,
						nodeTransform: cs?.transform !== "none" ? cs?.transform : null,
						parentTransform: parentCs?.transform !== "none" ? parentCs?.transform : null,
						className: nodeEl.className?.slice(0, 80) ?? null,
					},
					timestamp: Date.now(),
					sessionId: "debug-session",
				}),
			}).catch(() => {});
			sampleCount++;
		}
		// #endregion

		const role = getNodeRole(node, settings);
		if (role) {
			const labelText = getRoleLabel(role, settings);
			const label = createLabelEl(labelText);
			nodeEl.append(label);
		}

		const orderIndex = orderByNodeId.get(node.id);
		if (orderIndex != null) {
			const badge = createOrderBadgeEl(orderIndex);
			nodeEl.append(badge);
		}
	}

	// #region agent log
	const canvasRect = containerEl.getBoundingClientRect();
	const containerCs = window.getComputedStyle(containerEl);
	fetch("http://127.0.0.1:7243/ingest/453147b6-6b57-40b4-a769-82c9dd3c5ee7", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			location: "canvasNodeLabels.ts:syncCanvasRoleLabels",
			message: "Canvas container transform",
			data: {
				hypothesisId: "H3",
				containerTransform: containerCs.transform !== "none" ? containerCs.transform : null,
				containerRect: { left: canvasRect.left, top: canvasRect.top },
				nodeCount: data.nodes.length,
			},
			timestamp: Date.now(),
			sessionId: "debug-session",
		}),
	}).catch(() => {});
	// #endregion
}

/** Get center of an element in viewport coordinates. */
function getElCenter(el: HTMLElement): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Path midpoint in viewport (for matching this edge to its path). */
function getPathMidpointViewport(pathEl: SVGPathElement): { x: number; y: number } {
	const len = pathEl.getTotalLength();
	const pt = pathEl.getPointAtLength(len * 0.5);
	const svg = pathEl.ownerSVGElement;
	if (!svg) return { x: pt.x, y: pt.y };
	const ctm = svg.getScreenCTM();
	if (!ctm) return { x: pt.x, y: pt.y };
	return {
		x: pt.x * ctm.a + pt.y * ctm.c + ctm.e,
		y: pt.x * ctm.b + pt.y * ctm.d + ctm.f,
	};
}

/** Path midpoint in SVG coordinates (stable under pan/zoom when used for foreignObject). */
function getPathMidpointSvg(pathEl: SVGPathElement): { x: number; y: number } {
	const len = pathEl.getTotalLength();
	const pt = pathEl.getPointAtLength(len * 0.5);
	return { x: pt.x, y: pt.y };
}

/** Find the path whose midpoint is closest to the given viewport point (identifies the arrow for this edge). */
function findPathForEdge(containerEl: HTMLElement, targetViewportX: number, targetViewportY: number): SVGPathElement | null {
	const pathEls = Array.from(containerEl.querySelectorAll("path.canvas-display-path"));
	let best: SVGPathElement | null = null;
	let bestDist = Infinity;
	for (const p of pathEls) {
		if (!(p instanceof SVGPathElement)) continue;
		const mid = getPathMidpointViewport(p);
		const dx = mid.x - targetViewportX;
		const dy = mid.y - targetViewportY;
		const d = dx * dx + dy * dy;
		if (d < bestDist) {
			bestDist = d;
			best = p;
		}
	}
	return best;
}

/**
 * Sync floating edge mode labels: for each edge with a mode (inject/concatenate) or incoming to the running node,
 * show a label in the middle of the arrow via a foreignObject in the edge's SVG <g>, using path midpoint in SVG
 * coordinates so the label stays correct under pan/zoom. FO is placed at path midpoint (no left offset) to avoid clipping.
 * @param isStillActive - if provided, called after async load; when false we skip applying to avoid stale canvas
 */
export async function syncCanvasEdgeModeLabels(
	vault: Vault,
	canvasFilePath: string,
	containerEl: HTMLElement,
	canvas: LiveCanvas | null,
	isStillActive?: () => boolean
): Promise<void> {
	const data = await loadCanvasData(vault, canvasFilePath);
	if (isStillActive && !isStillActive()) return;
	if (!data?.edges) {
		clearCanvasEdgeModeLabels(containerEl);
		return;
	}
	// Clear only after we have data so we never paint a frame with labels removed and nothing to show (avoids flicker).
	clearCanvasEdgeModeLabels(containerEl);
	const canvasKey = getCanvasKey(canvasFilePath);
	const runningNodeId = getRunningNodeId(canvasKey);
	const SVG_NS = "http://www.w3.org/2000/svg";
	const Y_OFFSET_BELOW_PATH = 12;
	const FONT_SIZE = 11;
	const FONT_SIZE_RUNNING = 20;
	const DOT_R = 2.5;
	const DOT_R_RUNNING = 5;
	const DOT_TEXT_GAP = 6;
	for (const edge of data.edges) {
		if (isOutputEdge(edge)) continue;
		const isRunning = runningNodeId != null && edge.toNode === runningNodeId;
		const mode = getEdgeMode(canvasKey, edge.id);
		const state: EdgeDisplayState | null = isRunning
			? "running"
			: mode === "inject"
				? "inject"
				: mode === "concatenate"
					? "concatenate"
					: null;
		if (!state) continue;
		const fromEl =
			(canvas && getNodeElFromCanvas(canvas, edge.fromNode)) ||
			findNodeElementByDataId(containerEl, edge.fromNode);
		const toEl =
			(canvas && getNodeElFromCanvas(canvas, edge.toNode)) ||
			findNodeElementByDataId(containerEl, edge.toNode);
		if (!fromEl || !toEl) continue;
		const fromCenter = getElCenter(fromEl);
		const toCenter = getElCenter(toEl);
		const targetViewportX = (fromCenter.x + toCenter.x) / 2;
		const targetViewportY = (fromCenter.y + toCenter.y) / 2;
		const pathEl = findPathForEdge(containerEl, targetViewportX, targetViewportY);
		if (!pathEl) continue;
		const group = pathEl.closest("g");
		if (!group) continue;
		const mid = getPathMidpointSvg(pathEl);
		const labelGroup = document.createElementNS(SVG_NS, "g");
		labelGroup.setAttribute("class", EDGE_MODE_SVG_LABEL_CLASS);
		labelGroup.setAttribute(EDGE_MODE_DATA_ATTR, edge.id);
		labelGroup.setAttribute(EDGE_MODE_STATE_ATTR, state);
		labelGroup.setAttribute("transform", `translate(${mid.x}, ${mid.y + Y_OFFSET_BELOW_PATH})`);
		labelGroup.setAttribute("style", "z-index: 100; isolation: isolate;");
		const textContent =
			state === "running" ? "…" : state === "inject" ? "(injected)" : "(concatenated)";
		let textX = 0;
		const fontSize = state === "running" ? FONT_SIZE_RUNNING : FONT_SIZE;
		if (state === "running") {
			const circle = document.createElementNS(SVG_NS, "circle");
			circle.setAttribute("class", EDGE_MODE_ICON_CLASS);
			circle.setAttribute("cx", String(DOT_R_RUNNING + 2));
			circle.setAttribute("cy", String(fontSize * 0.4));
			circle.setAttribute("r", String(DOT_R_RUNNING));
			labelGroup.appendChild(circle);
			textX = DOT_R_RUNNING * 2 + DOT_TEXT_GAP;
		}
		const textEl = document.createElementNS(SVG_NS, "text");
		textEl.setAttribute("class", EDGE_MODE_LABEL_CLASS);
		textEl.setAttribute("x", String(textX));
		textEl.setAttribute("y", String(fontSize * 0.35));
		textEl.setAttribute("font-size", String(fontSize));
		textEl.setAttribute("text-anchor", "start");
		textEl.setAttribute("dominant-baseline", "central");
		textEl.textContent = textContent;
		labelGroup.appendChild(textEl);
		group.appendChild(labelGroup);
	}
	// Mark output edges so their label can be styled smaller/grayed
	for (const edge of data.edges) {
		if (!isOutputEdge(edge)) continue;
		const fromEl =
			(canvas && getNodeElFromCanvas(canvas, edge.fromNode)) ||
			findNodeElementByDataId(containerEl, edge.fromNode);
		const toEl =
			(canvas && getNodeElFromCanvas(canvas, edge.toNode)) ||
			findNodeElementByDataId(containerEl, edge.toNode);
		if (!fromEl || !toEl) continue;
		const fromCenter = getElCenter(fromEl);
		const toCenter = getElCenter(toEl);
		const targetViewportX = (fromCenter.x + toCenter.x) / 2;
		const targetViewportY = (fromCenter.y + toCenter.y) / 2;
		const pathEl = findPathForEdge(containerEl, targetViewportX, targetViewportY);
		if (!pathEl) continue;
		const group = pathEl.closest("g");
		if (group) group.classList.add(OUTPUT_EDGE_GROUP_CLASS);
	}
}
