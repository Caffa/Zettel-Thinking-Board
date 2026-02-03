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
import { parseEdgeVariableName } from "../canvas/types";
import {isTextNode} from "../canvas/types";
import type {LiveCanvas} from "./canvasApi";
import {getKernelForCanvas} from "./kernelManager";
import {ollamaGenerate} from "./ollama";
import {
	getCanvasKey,
	getNodeResult,
	setNodeResult,
	setEdgeModes,
	setRunningNodeId,
} from "./state";
import type {NodeRole, ZettelPluginSettings} from "../settings";

type EdgeInputMode = "inject" | "concatenate";

/** True if the role is non-AI (Python or pass-through); prefer running these first for early output. */
function isNonAIRole(role: NodeRole | null): boolean {
	return role === "blue" || role === "yellow";
}

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
function topologicalOrderToTarget(
	data: CanvasData,
	targetId: string,
	settings: ZettelPluginSettings
): string[] {
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
	return topologicalSort(data, execEdges, nodeIds, settings);
}

/** Topological order of all nodes reachable from any root (ignores output edges). */
function topologicalOrderFull(data: CanvasData, settings: ZettelPluginSettings): string[] {
	const roots = getRootIds(data);
	const execEdges = data.edges.filter((e) => !isOutputEdge(e));
	const nodeIds = new Set<string>();
	for (const rootId of roots) {
		const stack = [rootId];
		while (stack.length > 0) {
			const id = stack.pop()!;
			if (nodeIds.has(id)) continue;
			nodeIds.add(id);
			for (const e of execEdges) {
				if (e.fromNode === id) stack.push(e.toNode);
			}
		}
	}
	return topologicalSort(data, execEdges, nodeIds, settings);
}

function topologicalSort(
	data: CanvasData,
	execEdges: CanvasEdgeData[],
	nodeIds: Set<string>,
	settings: ZettelPluginSettings
): string[] {
	const inDegree = new Map<string, number>();
	for (const id of nodeIds) inDegree.set(id, 0);
	for (const e of execEdges) {
		if (nodeIds.has(e.fromNode) && nodeIds.has(e.toNode)) {
			inDegree.set(e.toNode, (inDegree.get(e.toNode) ?? 0) + 1);
		}
	}
	const order: string[] = [];
	const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0);
	sortQueueByNonAIFirst(queue, data, settings);
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
		sortQueueByNonAIFirst(queue, data, settings);
	}
	return order;
}

/** Sort ready queue: non-AI (Python, yellow) first for early output, then by y. */
function sortQueueByNonAIFirst(
	queue: string[],
	data: CanvasData,
	settings: ZettelPluginSettings
): void {
	queue.sort((a, b) => {
		const na = getNodeById(data, a);
		const nb = getNodeById(data, b);
		const roleA = getNodeRole(na ?? { color: undefined }, settings);
		const roleB = getNodeRole(nb ?? { color: undefined }, settings);
		const nonA = isNonAIRole(roleA) ? 0 : 1;
		const nonB = isNonAIRole(roleB) ? 0 : 1;
		if (nonA !== nonB) return nonA - nonB;
		return (na?.y ?? 0) - (nb?.y ?? 0);
	});
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

/** Persist only base variable name in edge.label; store inject/concatenate in state for floating label. */
async function updateEdgeLabelsAndSave(
	vault: App["vault"],
	canvasFilePath: string,
	data: CanvasData,
	nodeId: string,
	edgeModes: Map<string, EdgeInputMode>,
	liveCanvas: LiveCanvas | null
): Promise<void> {
	const canvasKey = getCanvasKey(canvasFilePath);
	setEdgeModes(canvasKey, edgeModes);
	let changed = false;
	for (const edge of data.edges) {
		if (edge.toNode !== nodeId) continue;
		if (isOutputEdge(edge)) continue;
		const mode = edgeModes.get(edge.id);
		if (mode == null) continue;
		const baseName = parseEdgeVariableName(edge.label);
		if (baseName.length === 0) continue;
		// Keep only the variable name in the stored label so the user can edit it without touching (injected)/(concatenated)
		if (edge.label !== baseName) {
			edge.label = baseName;
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
	if (role === "red") {
		const model = settings.ollamaRedModel || "llama2";
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

/** Max horizontal offset (px) for output box collision avoidance; beyond this we allow overlap. */
const OUTPUT_COLLISION_MAX_RADIUS = 500;
/** Step (px) between candidate x positions when avoiding collisions. */
const OUTPUT_COLLISION_STEP = 80;

function rectanglesOverlap(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number }
): boolean {
	return !(
		a.x + a.width <= b.x ||
		b.x + b.width <= a.x ||
		a.y + a.height <= b.y ||
		b.y + b.height <= a.y
	);
}

/** Choose an x for the output box to avoid overlapping other nodes; tries defaultX then right then left within maxRadius. */
function chooseOutputPosition(
	data: CanvasData,
	sourceNodeId: string,
	outNodeId: string | null,
	defaultX: number,
	y: number,
	width: number,
	height: number,
	maxRadius: number,
	step: number
): number {
	const excludeIds = new Set<string>([sourceNodeId]);
	if (outNodeId) excludeIds.add(outNodeId);
	const box = { x: 0, y, width, height };
	function tryX(x: number): boolean {
		box.x = x;
		for (const node of data.nodes) {
			if (excludeIds.has(node.id)) continue;
			if (rectanglesOverlap(box, { x: node.x, y: node.y, width: node.width, height: node.height })) {
				return false;
			}
		}
		return true;
	}
	if (tryX(defaultX)) return defaultX;
	for (let offset = step; offset <= maxRadius; offset += step) {
		if (tryX(defaultX + offset)) return defaultX + offset;
		if (tryX(defaultX - offset)) return defaultX - offset;
	}
	return defaultX;
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
	const y = sourceNode.y + sourceNode.height + GREEN_NODE_PADDING;
	const width = Math.max(320, sourceNode.width);
	const height = 180;
	const defaultX = sourceNode.x;
	const chosenX = chooseOutputPosition(
		data,
		sourceNode.id,
		outId,
		defaultX,
		y,
		width,
		height,
		OUTPUT_COLLISION_MAX_RADIUS,
		OUTPUT_COLLISION_STEP
	);
	const greenColor = settings.colorGreen;

	if (outId) {
		const outNode = getNodeById(data, outId);
		if (outNode && isTextNode(outNode)) {
			const updated = {
				...(outNode as CanvasTextData),
				text,
				x: chosenX,
				y,
				width,
				height,
			};
			const idx = data.nodes.findIndex((n) => n.id === outId);
			if (idx >= 0) data.nodes[idx] = updated;
		} else if (outNode) {
			(outNode as { x: number; y: number }).x = chosenX;
			(outNode as { x: number; y: number }).y = y;
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
		x: chosenX,
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

/** Run a single node (for "Run Node" command). If parents are not run, runs chain to this node instead. */
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
	const canvasKey = getCanvasKey(canvasFilePath);
	for (const pid of parentIds) {
		if (getNodeResult(canvasKey, pid) == null) {
			return runChain(app, settings, canvasFilePath, nodeId, liveCanvas);
		}
	}
	try {
		setRunningNodeId(canvasKey, nodeId);
		await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nodeId, liveCanvas);
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	} finally {
		setRunningNodeId(canvasKey, null);
	}
}

/** Run all nodes reachable from any root, in topological order. */
export async function runEntireCanvas(
	app: App,
	settings: ZettelPluginSettings,
	canvasFilePath: string,
	liveCanvas: LiveCanvas | null
): Promise<{ ok: boolean; message?: string }> {
	const data = await loadCanvasData(app.vault, canvasFilePath);
	if (!data) return { ok: false, message: "Could not load canvas data." };
	const order = topologicalOrderFull(data, settings);
	const canvasKey = getCanvasKey(canvasFilePath);
	try {
		for (const nid of order) {
			try {
				setRunningNodeId(canvasKey, nid);
				await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nid, liveCanvas);
			} finally {
				setRunningNodeId(canvasKey, null);
			}
		}
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
	const order = topologicalOrderToTarget(data, nodeId, settings);
	const canvasKey = getCanvasKey(canvasFilePath);
	try {
		for (const nid of order) {
			try {
				setRunningNodeId(canvasKey, nid);
				await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nid, liveCanvas);
			} finally {
				setRunningNodeId(canvasKey, null);
			}
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

/** Remove all Green output nodes and their output edges on the canvas; mutates data and saves. */
export async function dismissAllOutput(
	vault: App["vault"],
	canvasFilePath: string,
	liveCanvas: LiveCanvas | null
): Promise<void> {
	const data = await loadCanvasData(vault, canvasFilePath);
	if (!data) return;
	const outputNodeIds = new Set(
		data.edges
			.filter((e) => parseEdgeVariableName(e.label) === EDGE_LABEL_OUTPUT)
			.map((e) => e.toNode)
	);
	data.nodes = data.nodes.filter((n) => !outputNodeIds.has(n.id));
	data.edges = data.edges.filter((e) => parseEdgeVariableName(e.label) !== EDGE_LABEL_OUTPUT);
	liveCanvas?.setData?.(data);
	if (liveCanvas?.requestSave) liveCanvas.requestSave();
	await saveCanvasData(vault, canvasFilePath, data);
}
