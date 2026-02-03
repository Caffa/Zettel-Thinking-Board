import type {Vault} from "obsidian";
import {loadCanvasData} from "./nodes";
import {getNodeRole, isOutputEdge} from "./types";
import type {CanvasColor, NodeRole, ZettelPluginSettings} from "../settings";
import {getPresetColor, getRoleLabel} from "../settings";
import type {LiveCanvas} from "../engine/canvasApi";
import {getCanvasKey} from "../engine/state";
import {getEdgeMode} from "../engine/state";

const LABEL_CLASS = "ztb-node-role-label";
const LABEL_DATA_ATTR = "data-ztb-role-label";
const LEGEND_CLASS = "ztb-canvas-legend";
const EDGE_MODE_LABEL_CLASS = "ztb-edge-mode-label";
const EDGE_MODE_DATA_ATTR = "data-ztb-edge-id";
const ROLES: NodeRole[] = ["orange", "purple", "blue", "yellow", "green"];

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

/** Remove all role labels we added from the container. */
export function clearCanvasRoleLabels(containerEl: HTMLElement): void {
	containerEl.querySelectorAll(`.${LABEL_CLASS}`).forEach((el) => el.remove());
}

/** Remove the canvas legend from the container. */
export function clearCanvasLegend(containerEl: HTMLElement): void {
	containerEl.querySelectorAll(`.${LEGEND_CLASS}`).forEach((el) => el.remove());
}

/** Remove all floating edge mode labels (injected/concatenated) from the container. */
export function clearCanvasEdgeModeLabels(containerEl: HTMLElement): void {
	containerEl.querySelectorAll(`.${EDGE_MODE_LABEL_CLASS}`).forEach((el) => el.remove());
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

/** Build and append the color legend to the canvas container (vanilla DOM, no innerHTML). */
function syncCanvasLegend(containerEl: HTMLElement, settings: ZettelPluginSettings): void {
	clearCanvasLegend(containerEl);
	if (!settings.showNodeRoleLabels) return;
	const legend = document.createElement("div");
	legend.setAttribute("class", LEGEND_CLASS);
	const title = document.createElement("div");
	title.setAttribute("class", "ztb-legend-title");
	title.textContent = "Colors";
	legend.appendChild(title);
	for (const role of ROLES) {
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
	otherText.textContent = "Other colors = Comment";
	otherRow.appendChild(otherText);
	legend.appendChild(otherRow);
	containerEl.appendChild(legend);
}

/** Create a label element using Obsidian's canvas-node-label class (same as file nodes). */
function createLabelEl(text: string): HTMLElement {
	const el = document.createElement("div");
	el.setAttribute("class", `${LABEL_CLASS} canvas-node-label`);
	el.setAttribute(LABEL_DATA_ATTR, "1");
	el.textContent = text;
	return el;
}

/**
 * Sync floating role labels for the active canvas: for each node whose color maps to a role,
 * add a small label above the node (e.g. "Comment", "Python"). Removes existing labels first.
 * Uses the live canvas node map to find each node's DOM element (.canvas-node).
 */
export async function syncCanvasRoleLabels(
	vault: Vault,
	canvasFilePath: string,
	containerEl: HTMLElement,
	settings: ZettelPluginSettings,
	canvas: LiveCanvas | null
): Promise<void> {
	if (!settings.showNodeRoleLabels) {
		clearCanvasRoleLabels(containerEl);
		clearCanvasLegend(containerEl);
		return;
	}
	const data = await loadCanvasData(vault, canvasFilePath);
	if (!data?.nodes) {
		clearCanvasRoleLabels(containerEl);
		clearCanvasLegend(containerEl);
		return;
	}
	clearCanvasRoleLabels(containerEl);
	syncCanvasLegend(containerEl, settings);
	for (const node of data.nodes) {
		const role = getNodeRole(node, settings);
		if (!role) continue;
		const labelText = getRoleLabel(role, settings);
		const nodeEl =
			(canvas && getNodeElFromCanvas(canvas, node.id)) ||
			findNodeElementByDataId(containerEl, node.id);
		if (!nodeEl) continue;
		const label = createLabelEl(labelText);
		// Append after .canvas-node-container so it matches Obsidian file node label position
		nodeEl.append(label);
	}
}

/** Get center of an element in viewport coordinates. */
function getElCenter(el: HTMLElement): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Sync floating edge mode labels: for each edge that has a mode (inject/concatenate) in state,
 * show a small label at the edge midpoint so the user sees the mode without it being in the editable label.
 */
export async function syncCanvasEdgeModeLabels(
	vault: Vault,
	canvasFilePath: string,
	containerEl: HTMLElement,
	canvas: LiveCanvas | null
): Promise<void> {
	clearCanvasEdgeModeLabels(containerEl);
	const data = await loadCanvasData(vault, canvasFilePath);
	if (!data?.edges) return;
	const canvasKey = getCanvasKey(canvasFilePath);
	const containerRect = containerEl.getBoundingClientRect();
	for (const edge of data.edges) {
		if (isOutputEdge(edge)) continue;
		const mode = getEdgeMode(canvasKey, edge.id);
		if (!mode) continue;
		const fromEl =
			(canvas && getNodeElFromCanvas(canvas, edge.fromNode)) ||
			findNodeElementByDataId(containerEl, edge.fromNode);
		const toEl =
			(canvas && getNodeElFromCanvas(canvas, edge.toNode)) ||
			findNodeElementByDataId(containerEl, edge.toNode);
		if (!fromEl || !toEl) continue;
		const fromCenter = getElCenter(fromEl);
		const toCenter = getElCenter(toEl);
		const midX = (fromCenter.x + toCenter.x) / 2 - containerRect.left + containerEl.scrollLeft;
		const midY = (fromCenter.y + toCenter.y) / 2 - containerRect.top + containerEl.scrollTop;
		const label = document.createElement("div");
		label.setAttribute("class", EDGE_MODE_LABEL_CLASS);
		label.setAttribute(EDGE_MODE_DATA_ATTR, edge.id);
		label.textContent = mode === "inject" ? "(injected)" : "(concatenated)";
		label.style.position = "absolute";
		label.style.left = `${midX}px`;
		label.style.top = `${midY}px`;
		label.style.transform = "translate(-50%, 0)";
		// Slight offset so it sits below the edge line / main label
		label.style.marginTop = "4px";
		containerEl.appendChild(label);
	}
}
