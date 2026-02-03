import type {
	AllCanvasNodeData,
	CanvasData,
	CanvasEdgeData,
	CanvasFileData,
	CanvasNodeData,
	CanvasTextData,
} from "obsidian/canvas";
import type {CanvasColor, NodeRole, ZettelPluginSettings} from "../settings";

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
	const roles: NodeRole[] = ["orange", "purple", "blue", "yellow", "green"];
	for (const role of roles) {
		const key = `color${role.charAt(0).toUpperCase() + role.slice(1)}` as keyof ZettelPluginSettings;
		const settingColor = normalizeColor(settings[key] as CanvasColor | undefined);
		if (settingColor && nodeColor === settingColor) return role;
	}
	return null;
}

/** Get parent node IDs for a node, sorted by y (top to bottom). */
export function getParentIdsSortedByY(nodeId: string, data: CanvasData): string[] {
	const edges = data.edges.filter((e) => e.toNode === nodeId);
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

/** Find the Green (output) node that sits below a given source node. Returns node id or null. */
export function findOutputNodeForSource(
	data: CanvasData,
	sourceNodeId: string,
	settings: ZettelPluginSettings
): string | null {
	const source = getNodeById(data, sourceNodeId);
	if (!source) return null;
	const greenColor = normalizeColor(settings.colorGreen as CanvasColor | undefined);
	if (!greenColor) return null;
	const expectedY = source.y + source.height + GREEN_NODE_PADDING;
	const tolerance = 30; // allow small layout drift
	for (const node of data.nodes) {
		if (node.id === sourceNodeId) continue;
		if (normalizeColor(node.color) !== greenColor) continue;
		// Same x (or close), and y at or near expected
		if (Math.abs(node.x - source.x) > 50) continue;
		if (node.y < expectedY - tolerance || node.y > expectedY + tolerance) continue;
		return node.id;
	}
	return null;
}
