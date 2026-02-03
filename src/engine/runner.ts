import type {App} from "obsidian";
import {
	EDGE_LABEL_OUTPUT,
	findOutputNodeForSource,
	getNodeById,
	getNodeContent,
	getNodeRole,
	getIncomingEdgesWithLabels,
	getParentIdsSortedByY,
	GREEN_NODE_PADDING,
	isOutputEdge,
	loadCanvasData,
	saveCanvasData,
} from "../canvas/nodes";
import type {AllCanvasNodeData, CanvasData, CanvasEdgeData, CanvasTextData} from "../canvas/types";
import {
	EDGE_LABEL_CONCATENATED,
	EDGE_LABEL_INJECTED,
	parseEdgeVariableName,
} from "../canvas/types";
import {isTextNode} from "../canvas/types";
import type {LiveCanvas} from "./canvasApi";
import {getKernelForCanvas} from "./kernelManager";
import {ollamaGenerate} from "./ollama";
import {
	getCanvasKey,
	getNodeResult,
	setNodeResult,
} from "./state";
import type {ZettelPluginSettings} from "../settings";

type EdgeInputMode = "inject" | "concatenate";

/** Get all root node ids (no incoming non-output edges). */
function getRootIds(data: CanvasData): string[] {
	const hasIncoming = new Set(
		data.edges.filter((e) => !isOutputEdge(e)).map((e) => e.toNode)
	);
	return data.nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
}

/** Check if there is a path from fromId to toId (ignoring output edges). */
function canReach(data: CanvasData, fromId: string, toId: string): boolean {
	const visited = new Set<string>();
	const stack = [fromId];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (id === toId) return true;
		if (visited.has(id)) continue;
		visited.add(id);
		for (const e of data.edges) {
			if (!isOutputEdge(e) && e.fromNode === id) stack.push(e.toNode);
		}
	}
	return false;
}

/** Topological order of node ids (only nodes that are ancestors of target; ignores output edges). */
function topologicalOrderToTarget(data: CanvasData, targetId: string): string[] {
	const execEdges = data.edges.filter((e) => !isOutputEdge(e));
	const nodeIds = new Set<string>();
	const stack = [targetId];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (nodeIds.has(id)) continue;
		nodeIds.add(id);
		for (const e of execEdges) {
			if (e.toNode === id) stack.push(e.fromNode);
		}
	}
	const inDegree = new Map<string, number>();
	for (const id of nodeIds) inDegree.set(id, 0);
	for (const e of execEdges) {
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
		for (const e of execEdges) {
			if (e.fromNode === id && nodeIds.has(e.toNode)) {
				const d = (inDegree.get(e.toNode) ?? 0) - 1;
				inDegree.set(e.toNode, d);
				if (d === 0) queue.push(e.toNode);
			}
		}
	}
	return order;
}

/** Build concatenated context, template with {{var:name}} substituted, and per-edge mode. */
function buildInputWithVariables(
	canvasKey: string,
	nodeInput: string,
	incoming: { parentId: string; edge: CanvasEdgeData; variableName: string }[]
): { concatenatedPart: string; template: string; edgeModes: Map<string, EdgeInputMode> } {
	const edgeModes = new Map<string, EdgeInputMode>();
	const parentResults = new Map<string, string>();
	for (const { parentId } of incoming) {
		const r = getNodeResult(canvasKey, parentId);
		if (r != null) parentResults.set(parentId, r);
	}
	let concatenatedPart = "";
	const varValues: Record<string, string> = {};
	for (const { parentId, edge, variableName } of incoming) {
		const result = parentResults.get(parentId);
		if (result == null) continue;
		const usedAsVar =
			variableName.length > 0 && nodeInput.includes(`{{var:${variableName}}}`);
		if (usedAsVar) {
			edgeModes.set(edge.id, "inject");
			varValues[variableName] = result;
		} else {
			edgeModes.set(edge.id, "concatenate");
			concatenatedPart += result + "\n\n";
		}
	}
	let template = nodeInput;
	for (const [name, value] of Object.entries(varValues)) {
		template = template.split(`{{var:${name}}}`).join(value);
	}
	return {
		concatenatedPart: concatenatedPart.trim(),
		template,
		edgeModes,
	};
}

/** Update edge labels to show inject vs concatenate, then refresh view (if setData) and save canvas. */
async function updateEdgeLabelsAndSave(
	vault: App["vault"],
	canvasFilePath: string,
	data: CanvasData,
	nodeId: string,
	edgeModes: Map<string, EdgeInputMode>,
	liveCanvas: LiveCanvas | null
): Promise<void> {
	let changed = false;
	for (const edge of data.edges) {
		if (edge.toNode !== nodeId) continue;
		if (isOutputEdge(edge)) continue;
		const mode = edgeModes.get(edge.id);
		if (mode == null) continue;
		const baseName = parseEdgeVariableName(edge.label);
		if (baseName.length === 0) continue;
		const newLabel =
			mode === "inject" ? baseName + EDGE_LABEL_INJECTED : baseName + EDGE_LABEL_CONCATENATED;
		if (edge.label !== newLabel) {
			edge.label = newLabel;
			changed = true;
		}
	}
	// Always persist so output node/edge mutations from ensureOutputNodeAndEdge are saved
	liveCanvas?.setData?.(data);
	await saveCanvasData(vault, canvasFilePath, data);
}

/** Run a single node: get input + parent context (concatenate or {{var:name}}), call LLM or Python, store result. */
async function runSingleNode(
	app: App,
	settings: ZettelPluginSettings,
	canvasKey: string,
	canvasFilePath: string,
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
	const incoming = getIncomingEdgesWithLabels(nodeId, data);
	const nodeInput = await getNodeContent(node, app.vault);
	const { concatenatedPart, template, edgeModes } = buildInputWithVariables(
		canvasKey,
		nodeInput,
		incoming
	);
	const fullPrompt =
		concatenatedPart.length > 0 ? `${concatenatedPart}\n\n---\n\n${template}` : template;

	if (role === "orange") {
		const model = settings.ollamaOrangeModel || "llama2";
		const result = await ollamaGenerate({ model, prompt: fullPrompt, stream: false });
		setNodeResult(canvasKey, nodeId, result);
		ensureOutputNodeAndEdge(data, node, result, settings);
		await updateEdgeLabelsAndSave(app.vault, canvasFilePath, data, nodeId, edgeModes, liveCanvas);
		return result;
	}
	if (role === "purple") {
		const model = settings.ollamaPurpleModel || "llama2";
		const result = await ollamaGenerate({ model, prompt: fullPrompt, stream: false });
		setNodeResult(canvasKey, nodeId, result);
		ensureOutputNodeAndEdge(data, node, result, settings);
		await updateEdgeLabelsAndSave(app.vault, canvasFilePath, data, nodeId, edgeModes, liveCanvas);
		return result;
	}
	if (role === "blue") {
		const kernel = getKernelForCanvas(canvasKey, settings.pythonPath);
		const result = await kernel.run(template, concatenatedPart);
		setNodeResult(canvasKey, nodeId, result);
		ensureOutputNodeAndEdge(data, node, result, settings);
		await updateEdgeLabelsAndSave(app.vault, canvasFilePath, data, nodeId, edgeModes, liveCanvas);
		return result;
	}
	return "";
}

/** Generate a unique id for new canvas nodes/edges. */
function randomId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return "output-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
}

/** Create or replace the Green output node and ensure an edge labeled "output" from source. Mutates data only. */
function ensureOutputNodeAndEdge(
	data: CanvasData,
	sourceNode: AllCanvasNodeData,
	text: string,
	settings: ZettelPluginSettings
): void {
	const outId = findOutputNodeForSource(data, sourceNode.id, settings);
	const x = sourceNode.x;
	const y = sourceNode.y + sourceNode.height + GREEN_NODE_PADDING;
	const width = Math.max(200, sourceNode.width);
	const height = 100;
	const greenColor = settings.colorGreen;

	if (outId) {
		const outNode = getNodeById(data, outId);
		if (outNode && isTextNode(outNode)) {
			(outNode as CanvasTextData).text = text;
		}
		const hasOutputEdge = data.edges.some(
			(e) => e.fromNode === sourceNode.id && e.toNode === outId && parseEdgeVariableName(e.label) === EDGE_LABEL_OUTPUT
		);
		if (!hasOutputEdge) {
			data.edges.push({
				id: randomId(),
				fromNode: sourceNode.id,
				toNode: outId,
				label: EDGE_LABEL_OUTPUT,
			});
		}
		return;
	}

	const newNodeId = randomId();
	const newTextNode: CanvasTextData = {
		id: newNodeId,
		type: "text",
		text,
		x,
		y,
		width,
		height,
		color: greenColor,
	};
	data.nodes.push(newTextNode);
	data.edges.push({
		id: randomId(),
		fromNode: sourceNode.id,
		toNode: newNodeId,
		label: EDGE_LABEL_OUTPUT,
	});
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
		await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nodeId, liveCanvas);
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
			await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nid, liveCanvas);
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

/** Remove the Green output node and its output edge for a given source node; mutates data and saves. */
export async function dismissOutput(
	vault: App["vault"],
	canvasFilePath: string,
	sourceNodeId: string,
	settings: ZettelPluginSettings,
	liveCanvas: LiveCanvas | null
): Promise<void> {
	const data = await loadCanvasData(vault, canvasFilePath);
	if (!data) return;
	const outId = findOutputNodeForSource(data, sourceNodeId, settings);
	if (!outId) return;
	data.nodes = data.nodes.filter((n) => n.id !== outId);
	data.edges = data.edges.filter(
		(e) => !(e.fromNode === sourceNodeId && parseEdgeVariableName(e.label) === EDGE_LABEL_OUTPUT)
	);
	liveCanvas?.setData?.(data);
	if (liveCanvas?.requestSave) liveCanvas.requestSave();
	await saveCanvasData(vault, canvasFilePath, data);
}
