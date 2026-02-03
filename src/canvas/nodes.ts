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
	findOutputNodeForSource,
	getNodeById,
	getNodeRole,
	getParentIdsSortedByY,
	GREEN_NODE_PADDING,
	isFileNode,
	isTextNode,
} from "./types";
export type {CanvasData, AllCanvasNodeData} from "./types";
