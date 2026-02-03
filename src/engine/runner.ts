import type {App} from "obsidian";
import {
	findOutputNodeForSource,
	getNodeById,
	getNodeContent,
	getNodeRole,
	getParentIdsSortedByY,
	GREEN_NODE_PADDING,
	loadCanvasData,
} from "../canvas/nodes";
import type {AllCanvasNodeData, CanvasData} from "../canvas/types";
import type {LiveCanvas} from "./canvasApi";
import {getKernelForCanvas} from "./kernelManager";
import {ollamaGenerate} from "./ollama";
import {
	getCanvasKey,
	getNodeResult,
	setNodeResult,
} from "./state";
import type {ZettelPluginSettings} from "../settings";

/** Get all root node ids (no incoming edges). */
function getRootIds(data: CanvasData): string[] {
	const hasIncoming = new Set(data.edges.map((e) => e.toNode));
	return data.nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
}

/** Check if there is a path from fromId to toId. */
function canReach(data: CanvasData, fromId: string, toId: string): boolean {
	const visited = new Set<string>();
	const stack = [fromId];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (id === toId) return true;
		if (visited.has(id)) continue;
		visited.add(id);
		for (const e of data.edges) {
			if (e.fromNode === id) stack.push(e.toNode);
		}
	}
	return false;
}

/** Topological order of node ids (only nodes that are ancestors of target). */
function topologicalOrderToTarget(data: CanvasData, targetId: string): string[] {
	const nodeIds = new Set<string>();
	const stack = [targetId];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (nodeIds.has(id)) continue;
		nodeIds.add(id);
		for (const e of data.edges) {
			if (e.toNode === id) stack.push(e.fromNode);
		}
	}
	const inDegree = new Map<string, number>();
	for (const id of nodeIds) inDegree.set(id, 0);
	for (const e of data.edges) {
		if (nodeIds.has(e.fromNode) && nodeIds.has(e.toNode)) {
			inDegree.set(e.toNode, (inDegree.get(e.toNode) ?? 0) + 1);
		}
	}
	const order: string[] = [];
	const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0).sort((a, b) => {
		const na = getNodeById(data, a);
		const nb = getNodeById(data, b);
		return (na?.y ?? 0) - (nb?.y ?? 0);
	});
	while (queue.length > 0) {
		const id = queue.shift()!;
		order.push(id);
		for (const e of data.edges) {
			if (e.fromNode === id && nodeIds.has(e.toNode)) {
				const d = (inDegree.get(e.toNode) ?? 0) - 1;
				inDegree.set(e.toNode, d);
				if (d === 0) queue.push(e.toNode);
			}
		}
	}
	return order;
}

/** Run a single node: get input + parent context, call LLM or Python, store result. */
async function runSingleNode(
	app: App,
	settings: ZettelPluginSettings,
	canvasKey: string,
	data: CanvasData,
	nodeId: string,
	liveCanvas: LiveCanvas | null
): Promise<string> {
	const node = getNodeById(data, nodeId);
	if (!node) return "";
	const role = getNodeRole(node, settings);
	if (!role || role === "yellow" || role === "green") {
		// Yellow: pass-through (use node content as result)
		if (role === "yellow") {
			const content = await getNodeContent(node, app.vault);
			setNodeResult(canvasKey, nodeId, content);
			return content;
		}
		return "";
	}
	const parentIds = getParentIdsSortedByY(nodeId, data);
	let parentContext = "";
	for (const pid of parentIds) {
		const r = getNodeResult(canvasKey, pid);
		if (r != null) parentContext += r + "\n\n";
	}
	const nodeInput = await getNodeContent(node, app.vault);
	const fullPrompt = parentContext ? `${parentContext}---\n${nodeInput}` : nodeInput;

	if (role === "orange") {
		const model = settings.ollamaOrangeModel || "llama2";
		const result = await ollamaGenerate({ model, prompt: fullPrompt, stream: false });
		setNodeResult(canvasKey, nodeId, result);
		if (liveCanvas) createGreenNode(liveCanvas, node, result);
		return result;
	}
	if (role === "purple") {
		const model = settings.ollamaPurpleModel || "llama2";
		const result = await ollamaGenerate({ model, prompt: fullPrompt, stream: false });
		setNodeResult(canvasKey, nodeId, result);
		if (liveCanvas) createGreenNode(liveCanvas, node, result);
		return result;
	}
	if (role === "blue") {
		const kernel = getKernelForCanvas(canvasKey, settings.pythonPath);
		const result = await kernel.run(nodeInput, parentContext.trim());
		setNodeResult(canvasKey, nodeId, result);
		if (liveCanvas) createGreenNode(liveCanvas, node, result);
		return result;
	}
	return "";
}

/** Create a Green (output) text node below the source node. */
function createGreenNode(liveCanvas: LiveCanvas, sourceNode: AllCanvasNodeData, text: string): void {
	const x = sourceNode.x;
	const y = sourceNode.y + sourceNode.height + GREEN_NODE_PADDING;
	const width = Math.max(200, sourceNode.width);
	const height = 100;
	const textNode = liveCanvas.createTextNode({
		text,
		pos: { x, y },
		size: { width, height },
		save: false,
		focus: false,
	});
	liveCanvas.addNode(textNode);
	textNode.moveTo({ x, y });
	textNode.resize({ width, height });
	if (liveCanvas.requestSave) liveCanvas.requestSave();
}

/** Run a single node (for "Run Node" command). Returns result or error message. */
export async function runNode(
	app: App,
	settings: ZettelPluginSettings,
	canvasFilePath: string,
	nodeId: string,
	liveCanvas: LiveCanvas | null
): Promise<{ ok: boolean; message?: string }> {
	const data = await loadCanvasData(app.vault, canvasFilePath);
	if (!data) return { ok: false, message: "Could not load canvas data." };
	const node = getNodeById(data, nodeId);
	if (!node) return { ok: false, message: "Node not found." };
	const role = getNodeRole(node, settings);
	if (!role) return { ok: false, message: "Node color is not mapped to a role." };
	if (role === "green") return { ok: false, message: "Green nodes are output-only." };
	const parentIds = getParentIdsSortedByY(nodeId, data);
	for (const pid of parentIds) {
		if (getNodeResult(getCanvasKey(canvasFilePath), pid) == null) {
			return { ok: false, message: "Parent node(s) have not been run yet. Run chain or run parents first." };
		}
	}
	const canvasKey = getCanvasKey(canvasFilePath);
	try {
		await runSingleNode(app, settings, canvasKey, data, nodeId, liveCanvas);
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

/** Run chain from roots to the given node. */
export async function runChain(
	app: App,
	settings: ZettelPluginSettings,
	canvasFilePath: string,
	nodeId: string,
	liveCanvas: LiveCanvas | null
): Promise<{ ok: boolean; message?: string }> {
	const data = await loadCanvasData(app.vault, canvasFilePath);
	if (!data) return { ok: false, message: "Could not load canvas data." };
	const roots = getRootIds(data);
	const rootsReachingCurrent = roots.filter((r) => canReach(data, r, nodeId));
	if (rootsReachingCurrent.length === 0) return { ok: false, message: "No root reaches this node." };
	const order = topologicalOrderToTarget(data, nodeId);
	const canvasKey = getCanvasKey(canvasFilePath);
	try {
		for (const nid of order) {
			await runSingleNode(app, settings, canvasKey, data, nid, liveCanvas);
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

/** Remove the Green output node for a given source node. */
export function dismissOutput(
	data: CanvasData,
	sourceNodeId: string,
	settings: ZettelPluginSettings,
	liveCanvas: LiveCanvas | null
): void {
	if (!liveCanvas?.removeNode) return;
	const outId = findOutputNodeForSource(data, sourceNodeId, settings);
	if (!outId) return;
	const nodes = liveCanvas.nodes;
	if (nodes instanceof Map) {
		const node = nodes.get(outId);
		if (node) liveCanvas.removeNode(node);
	} else if (nodes) {
		for (const n of nodes as Iterable<{ id: string }>) {
			if (n.id === outId) {
				liveCanvas.removeNode?.(n);
				break;
			}
		}
	}
	if (liveCanvas.requestSave) liveCanvas.requestSave();
}
