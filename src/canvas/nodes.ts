import type {Vault} from "obsidian";
import type {AllCanvasNodeData, CanvasData, CanvasFileData, CanvasTextData} from "obsidian/canvas";
import {
	getFileNodePath,
	getNodeById,
	getNodeRole,
	getParentIdsSortedByY,
	getTextNodeContent,
	isFileNode,
	isTextNode,
} from "./types";
import type {ZettelPluginSettings} from "../settings";

/** Load canvas data from vault by reading the canvas file (JSON). */
export async function loadCanvasData(vault: Vault, filePath: string): Promise<CanvasData | null> {
	try {
		const raw = await vault.adapter.read(filePath);
		const data = JSON.parse(raw) as CanvasData;
		if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) return data;
	} catch {
		// ignore
	}
	return null;
}

/** Save canvas data to vault (writes the canvas file). */
export async function saveCanvasData(vault: Vault, filePath: string, data: CanvasData): Promise<boolean> {
	try {
		const raw = JSON.stringify(data);
		await vault.adapter.write(filePath, raw);
		return true;
	} catch {
		return false;
	}
}

/** Get input content for a node: text node content or full file content. */
export async function getNodeContent(
	node: AllCanvasNodeData,
	vault: Vault
): Promise<string> {
	if (isTextNode(node)) return getTextNodeContent(node as CanvasTextData);
	if (isFileNode(node)) {
		const path = getFileNodePath(node as CanvasFileData);
		if (!path) return "";
		const file = vault.getFileByPath(path);
		if (file) {
			try {
				return await vault.cachedRead(file);
			} catch {
				//
			}
		}
		return "";
	}
	return "";
}

// Re-export for callers
export {
	EDGE_LABEL_OUTPUT,
	findOutputNodeForSource,
	getNodeById,
	getNodeRole,
	getParentIdsSortedByY,
	getIncomingEdgesWithLabels,
	GREEN_NODE_PADDING,
	hasOutputNodes,
	isFileNode,
	isOutputEdge,
	isTextNode,
	parseEdgeVariableName,
} from "./types";
export type {CanvasData, AllCanvasNodeData, IncomingEdgeInfo} from "./types";
