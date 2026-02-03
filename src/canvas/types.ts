import type {
	AllCanvasNodeData,
	CanvasData,
	CanvasEdgeData,
	CanvasFileData,
	CanvasNodeData,
	CanvasTextData,
} from "obsidian/canvas";
import type {CanvasColor, NodeRole, ZettelPluginSettings} from "../settings";
import {COLOR_ROLES} from "../settings";

export type {AllCanvasNodeData, CanvasData, CanvasEdgeData, CanvasFileData, CanvasNodeData, CanvasTextData};

/** Normalize color for comparison (e.g. trim, lowercase hex). */
export function normalizeColor(c: CanvasColor | undefined): string {
	if (c == null || c === "") return "";
	const s = String(c).trim();
	if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
	return s;
}

/** Classify node role by comparing node color to settings. */
export function getNodeRole(node: { color?: CanvasColor }, settings: ZettelPluginSettings): NodeRole | null {
	const nodeColor = normalizeColor(node.color);
	if (!nodeColor) return null;
	for (const role of COLOR_ROLES) {
		const key = `color${role.charAt(0).toUpperCase() + role.slice(1)}` as keyof ZettelPluginSettings;
		const settingColor = normalizeColor(settings[key] as CanvasColor | undefined);
		if (settingColor && nodeColor === settingColor) return role;
	}
	return null;
}

/** Suffixes we add to edge labels after run to show inject vs concatenate. */
export const EDGE_LABEL_INJECTED = " (injected)";
export const EDGE_LABEL_CONCATENATED = " (concatenated)";

/** Reserved edge label from run node to its green output note; not a variable name. */
export const EDGE_LABEL_OUTPUT = "output";

/** Parse variable name from edge label; ignore anything in brackets at the end. */
export function parseEdgeVariableName(label: string | undefined): string {
	if (label == null || typeof label !== "string") return "";
	const s = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
	return s;
}

/** True if edge is the reserved output edge (run node → green output note); ignored by execution. */
export function isOutputEdge(edge: CanvasEdgeData): boolean {
	return parseEdgeVariableName(edge.label) === EDGE_LABEL_OUTPUT;
}

/** Incoming edge with parent id and optional variable name (from label). */
export interface IncomingEdgeInfo {
	parentId: string;
	edge: CanvasEdgeData;
	variableName: string;
}

/** Get incoming edges for a node with parent id and variable name, sorted by parent y. Excludes output edges. */
export function getIncomingEdgesWithLabels(nodeId: string, data: CanvasData): IncomingEdgeInfo[] {
	const edges = data.edges.filter((e) => e.toNode === nodeId && !isOutputEdge(e));
	const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
	const withY = edges.map((e) => {
		const parent = nodeMap.get(e.fromNode);
		const y = parent?.y ?? 0;
		return {
			parentId: e.fromNode,
			edge: e,
			variableName: parseEdgeVariableName(e.label),
			y,
		};
	});
	withY.sort((a, b) => a.y - b.y);
	return withY.map(({ parentId, edge, variableName }) => ({ parentId, edge, variableName }));
}

/** Get parent node IDs for a node, sorted by y (top to bottom). Excludes output edges. */
export function getParentIdsSortedByY(nodeId: string, data: CanvasData): string[] {
	const edges = data.edges.filter((e) => e.toNode === nodeId && !isOutputEdge(e));
	const fromIds = [...new Set(edges.map((e) => e.fromNode))];
	const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
	const withY = fromIds
		.map((id) => {
			const node = nodeMap.get(id);
			return node ? { id, y: node.y } : null;
		})
		.filter((x): x is { id: string; y: number } => x != null);
	withY.sort((a, b) => a.y - b.y);
	return withY.map((x) => x.id);
}

/** Get node by id from canvas data. */
export function getNodeById(data: CanvasData, id: string): AllCanvasNodeData | undefined {
	return data.nodes.find((n) => n.id === id);
}

/** Check if node is text type. */
export function isTextNode(node: AllCanvasNodeData): node is CanvasTextData {
	return (node as CanvasTextData).type === "text";
}

/** Check if node is file type. */
export function isFileNode(node: AllCanvasNodeData): node is CanvasFileData {
	return (node as CanvasFileData).type === "file";
}

/** Get raw text content from a text node. */
export function getTextNodeContent(node: CanvasTextData): string {
	return node.text ?? "";
}

/** Get file path from a file node (relative to vault). */
export function getFileNodePath(node: CanvasFileData): string {
	return node.file ?? "";
}

/** Fixed padding between source node and its Green output node (Part 1). */
export const GREEN_NODE_PADDING = 20;

/** Max vertical offset (px) below default placement when finding output by position; must match runner collision range. */
export const OUTPUT_POSITION_FALLBACK_MAX_Y = 450;

/** Find the Green (output) node for a given source node. Edge-first (label "output"), then position fallback. */
export function findOutputNodeForSource(
	data: CanvasData,
	sourceNodeId: string,
	settings: ZettelPluginSettings
): string | null {
	const outputEdge = data.edges.find(
		(e) => e.fromNode === sourceNodeId && parseEdgeVariableName(e.label) === EDGE_LABEL_OUTPUT
	);
	if (outputEdge) return outputEdge.toNode;
	const source = getNodeById(data, sourceNodeId);
	if (!source) return null;
	const greenColor = normalizeColor(settings.colorGreen as CanvasColor | undefined);
	if (!greenColor) return null;
	const expectedY = source.y + source.height + GREEN_NODE_PADDING;
	const toleranceAbove = 30; // allow small layout drift above default
	const candidates: { id: string; centerY: number }[] = [];
	for (const node of data.nodes) {
		if (node.id === sourceNodeId) continue;
		if (normalizeColor(node.color) !== greenColor) continue;
		if (Math.abs(node.x - source.x) > 50) continue;
		if (node.y < expectedY - toleranceAbove || node.y > expectedY + OUTPUT_POSITION_FALLBACK_MAX_Y) continue;
		const centerY = node.y + (node.height ?? 0) / 2;
		candidates.push({ id: node.id, centerY });
	}
	if (candidates.length === 0) return null;
	// Prefer the green whose center is closest to expectedY (avoids wrong match when sources are stacked)
	const best = candidates.reduce((a, b) =>
		Math.abs(a.centerY - expectedY) <= Math.abs(b.centerY - expectedY) ? a : b
	);
	return best.id;
}

/** Check if canvas has any output nodes (green nodes connected by output edges). */
export function hasOutputNodes(data: CanvasData): boolean {
	return data.edges.some((e) => isOutputEdge(e));
}
