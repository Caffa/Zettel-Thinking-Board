import type {App} from "obsidian";
import {Notice} from "obsidian";
import {
	EDGE_LABEL_OUTPUT,
	EDGE_LABEL_PROMPT,
	EDGE_LABEL_THINKING,
	findAuxiliaryNodeForSource,
	findOutputNodeForSource,
	getNodeById,
	getNodeContent,
	getNodeRole,
	getIncomingEdgesWithLabels,
	getParentIdsSortedByY,
	getSourceNodeForOutputNode,
	GREEN_NODE_PADDING,
	isAuxiliaryEdge,
	loadCanvasData,
	saveCanvasData,
} from "../canvas/nodes";
import type {AllCanvasNodeData, CanvasData, CanvasEdgeData, CanvasTextData} from "../canvas/types";
import { getTextNodeContent, parseEdgeVariableName } from "../canvas/types";
import {isTextNode} from "../canvas/types";
import type {LiveCanvas} from "./canvasApi";
import {getKernelForCanvas} from "./kernelManager";
import {ollamaGenerate} from "./ollama";
import type {RunStartCanvasData} from "./state";
import {
	getCanvasKey,
	getNodeResult,
	setNodeResult,
	setNodeDuration,
	setEdgeModes,
	setRunningNodeId,
} from "./state";
import {DEFAULT_SETTINGS, shadeColor, type NodeRole, type ZettelPluginSettings} from "../settings";

type EdgeInputMode = "inject" | "concatenate";

/** True if the role is non-AI (Python or text pass-through); prefer running these first for early output. */
function isNonAIRole(role: NodeRole | null): boolean {
	return role === "blue" || role === "yellow";
}

/** Execution edges with connections to green output nodes redirected to each output's source node. */
function getExecEdgesWithOutputRedirection(data: CanvasData): CanvasEdgeData[] {
	return data.edges
		.filter((e) => !isAuxiliaryEdge(e))
		.map((e) => {
			const source = getSourceNodeForOutputNode(data, e.fromNode);
			if (source != null) return { ...e, fromNode: source };
			return e;
		});
}

/** Get all root node ids (no incoming non-auxiliary edges; output-node connections count as to source). */
function getRootIds(data: CanvasData): string[] {
	const execEdges = getExecEdgesWithOutputRedirection(data);
	const hasIncoming = new Set(execEdges.map((e) => e.toNode));
	return data.nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
}

/** Check if there is a path from fromId to toId (ignoring auxiliary edges; output nodes redirect to source). */
function canReach(data: CanvasData, fromId: string, toId: string): boolean {
	const execEdges = getExecEdgesWithOutputRedirection(data);
	const visited = new Set<string>();
	const stack = [fromId];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (id === toId) return true;
		if (visited.has(id)) continue;
		visited.add(id);
		for (const e of execEdges) {
			if (e.fromNode === id) stack.push(e.toNode);
		}
	}
	return false;
}

/** Result of topological sort: either a valid order or cycle detected. */
type TopoResult = { order: string[] } | { cycle: true };

/** Topological order of node ids (only nodes that are ancestors of target; ignores auxiliary edges; output-node connections redirect to source). */
function topologicalOrderToTarget(
	data: CanvasData,
	targetId: string,
	settings: ZettelPluginSettings
): TopoResult {
	const execEdges = getExecEdgesWithOutputRedirection(data);
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

/** Topological order of all nodes reachable from any root (ignores auxiliary edges; output-node connections redirect to source). */
function topologicalOrderFull(data: CanvasData, settings: ZettelPluginSettings): TopoResult {
	const roots = getRootIds(data);
	const execEdges = getExecEdgesWithOutputRedirection(data);
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
): TopoResult {
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
	if (order.length !== nodeIds.size) {
		return { cycle: true };
	}
	return { order };
}

/** Return topological execution order (1st run = index 0), or null if graph has a cycle. Used for UI order badges. */
export function getTopologicalOrder(
	data: CanvasData,
	settings: ZettelPluginSettings
): string[] | null {
	const result = topologicalOrderFull(data, settings);
	return "cycle" in result ? null : result.order;
}

/** Sort ready queue: non-AI (Python, text) first for early output, then by y. */
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

/** True if text is already wrapped in ```python or ``` ... ```. */
function isPythonCodeFenced(text: string): boolean {
	const lines = text.trim().split(/\r?\n/);
	if (lines.length < 2) return false;
	const first = lines[0];
	const last = lines[lines.length - 1];
	if (first == null || last == null) return false;
	return /^```(?:python)?\s*$/i.test(first.trim()) && /^```\s*$/.test(last.trim());
}

/** Wrap in ```python ... ``` if not already fenced (so Obsidian renders # as comment). */
function ensurePythonCodeFence(text: string): string {
	if (isPythonCodeFenced(text)) return text;
	return "```python\n" + text.trim() + "\n```";
}

/** Strip optional markdown code fence (```python or ```) so execution runs raw code. */
function stripPythonCodeFence(template: string): string {
	const lines = template.split(/\r?\n/);
	if (lines.length < 2) return template.trim();
	const first = lines[0];
	const last = lines[lines.length - 1];
	if (first == null || last == null) return template.trim();
	if (/^```(?:python)?\s*$/i.test(first.trim()) && /^```\s*$/.test(last.trim())) {
		return lines.slice(1, -1).join("\n").trim();
	}
	return template.trim();
}

/** Build concatenated context, template with {{var:name}} (and optionally {{name}}) substituted, and per-edge mode. */
function buildInputWithVariables(
	canvasKey: string,
	nodeInput: string,
	incoming: { parentId: string; edge: CanvasEdgeData; variableName: string }[],
	settings: ZettelPluginSettings
): { concatenatedPart: string; template: string; edgeModes: Map<string, EdgeInputMode> } {
	const edgeModes = new Map<string, EdgeInputMode>();
	const parentResults = new Map<string, string>();
	for (const { parentId } of incoming) {
		const r = getNodeResult(canvasKey, parentId);
		if (r != null) parentResults.set(parentId, r);
	}
	let concatenatedPart = "";
	const varValues: Record<string, string> = {};
	const shorthand = settings.supportShorthandPlaceholders;
	for (const { parentId, edge, variableName } of incoming) {
		const result = parentResults.get(parentId);
		if (result == null) continue;
		const usedAsVar =
			variableName.length > 0 &&
			(nodeInput.includes(`{{var:${variableName}}}`) || (shorthand && nodeInput.includes(`{{${variableName}}}`)));
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
		if (shorthand) template = template.split(`{{${name}}}`).join(value);
	}
	return {
		concatenatedPart: concatenatedPart.trim(),
		template,
		edgeModes,
	};
}

/** Set of node ids that are our output/prompt/thinking nodes; we must not overwrite them with live data. */
function getAuxiliaryNodeIds(data: CanvasData): Set<string> {
	const auxiliaryLabels = [EDGE_LABEL_OUTPUT, EDGE_LABEL_PROMPT, EDGE_LABEL_THINKING];
	return new Set(
		data.edges
			.filter((e) => auxiliaryLabels.includes(parseEdgeVariableName(e.label)))
			.map((e) => e.toNode)
	);
}

/** Copy color (and position/size) from live canvas nodes into data for non-auxiliary nodes so we don't overwrite user edits. */
function mergePreserveUserNodeProps(
	data: CanvasData,
	liveData: { nodes: Array<{ id: string; color?: string; x?: number; y?: number; width?: number; height?: number }> }
): void {
	const liveById = new Map(liveData.nodes.map((n) => [n.id, n]));
	const auxiliaryIds = getAuxiliaryNodeIds(data);
	for (const node of data.nodes) {
		if (auxiliaryIds.has(node.id)) continue;
		const liveNode = liveById.get(node.id);
		if (!liveNode) continue;
		if (liveNode.color !== undefined && liveNode.color !== "") {
			(node as { color?: string }).color = liveNode.color;
		}
		if (typeof liveNode.x === "number") (node as { x: number }).x = liveNode.x;
		if (typeof liveNode.y === "number") (node as { y: number }).y = liveNode.y;
		if (typeof liveNode.width === "number") (node as { width: number }).width = liveNode.width;
		if (typeof liveNode.height === "number") (node as { height: number }).height = liveNode.height;
	}
}

/** Persist only base variable name in edge.label; store inject/concatenate in state for floating label. */
async function updateEdgeLabelsAndSave(
	vault: App["vault"],
	canvasFilePath: string,
	data: CanvasData,
	nodeId: string,
	edgeModes: Map<string, EdgeInputMode>,
	liveCanvas: LiveCanvas | null,
	runStartData: RunStartCanvasData
): Promise<void> {
	const canvasKey = getCanvasKey(canvasFilePath);
	setEdgeModes(canvasKey, edgeModes);
	let changed = false;
	for (const edge of data.edges) {
		if (edge.toNode !== nodeId) continue;
		if (isAuxiliaryEdge(edge)) continue;
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
	const liveData = liveCanvas?.getData?.();
	// Remove auxiliary nodes that were on canvas at run start but are no longer in live (user deleted / moved away)
	if (runStartData?.nodes && liveData?.nodes) {
		const runStartNodeIds = new Set(runStartData.nodes.map((n) => n.id));
		const liveNodeIds = new Set(liveData.nodes.map((n) => n.id));
		const auxiliaryIds = getAuxiliaryNodeIds(data);
		const toRemove = new Set<string>();
		for (const id of auxiliaryIds) {
			if (runStartNodeIds.has(id) && !liveNodeIds.has(id)) toRemove.add(id);
		}
		if (toRemove.size > 0) {
			data.nodes = data.nodes.filter((n) => !toRemove.has(n.id));
			data.edges = data.edges.filter((e) => !toRemove.has(e.fromNode) && !toRemove.has(e.toNode));
		}
	}
	// Preserve user edits (e.g. node color, position) from live canvas before we overwrite with our data
	// #region agent log
	const outBeforeMerge = countOutputNodeIds(data);
	fetch("http://127.0.0.1:7243/ingest/453147b6-6b57-40b4-a769-82c9dd3c5ee7", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "runner.ts:updateEdgeLabelsAndSave", message: "before merge/setData", data: { dataOutputCount: outBeforeMerge.count, dataOutputIds: outBeforeMerge.ids, liveNodeCount: liveData?.nodes?.length ?? 0 }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H2-H3" }) }).catch(() => {});
	// #endregion
	if (liveData?.nodes) {
		mergePreserveUserNodeProps(data, liveData);
	}
	// Always persist so output node/edge mutations from ensureOutputNodeAndEdge are saved
	liveCanvas?.setData?.(data);
	// #region agent log
	const outAfterSetData = countOutputNodeIds(data);
	fetch("http://127.0.0.1:7243/ingest/453147b6-6b57-40b4-a769-82c9dd3c5ee7", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "runner.ts:updateEdgeLabelsAndSave", message: "after setData", data: { dataOutputCount: outAfterSetData.count, dataOutputIds: outAfterSetData.ids }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H2-H3" }) }).catch(() => {});
	// #endregion
	if (liveCanvas?.requestSave) liveCanvas.requestSave(); // so Obsidian marks canvas dirty and won't overwrite on tab switch
	const saved = await saveCanvasData(vault, canvasFilePath, data);
	if (!saved) new Notice("Failed to save canvas.");
}

/** Run a single node: get input + parent context (concatenate or {{var:name}}), call LLM or Python, store result. */
async function runSingleNode(
	app: App,
	settings: ZettelPluginSettings,
	canvasKey: string,
	canvasFilePath: string,
	data: CanvasData,
	nodeId: string,
	liveCanvas: LiveCanvas | null,
	runStartData: RunStartCanvasData
): Promise<string> {
	const node = getNodeById(data, nodeId);
	if (!node) return "";
	const role = getNodeRole(node, settings);
	if (!role || role === "yellow" || role === "green") {
		// Yellow = text (input pass-through): merge parent results with own content, same as AI/Python nodes
		if (role === "yellow") {
			const incoming = getIncomingEdgesWithLabels(nodeId, data);
			const nodeInput = await getNodeContent(node, app.vault);
			const { concatenatedPart, template } = buildInputWithVariables(
				canvasKey,
				nodeInput,
				incoming,
				settings
			);
			const fullContent =
				concatenatedPart.length > 0 ? `${concatenatedPart}\n\n---\n\n${template}` : template;
			setNodeResult(canvasKey, nodeId, fullContent);
			return fullContent;
		}
		return "";
	}
	// For Python (blue) text nodes, auto-wrap content in ```python ... ``` so # comments render correctly
	if (role === "blue" && isTextNode(node)) {
		const raw = getTextNodeContent(node as CanvasTextData);
		if (!isPythonCodeFenced(raw)) {
			(node as CanvasTextData).text = ensurePythonCodeFence(raw);
			const liveData = liveCanvas?.getData?.();
			if (liveData?.nodes) mergePreserveUserNodeProps(data, liveData);
			liveCanvas?.setData?.(data);
			if (liveCanvas?.requestSave) liveCanvas.requestSave();
			await saveCanvasData(app.vault, canvasFilePath, data);
		}
	}
	const incoming = getIncomingEdgesWithLabels(nodeId, data);
	const nodeInput = await getNodeContent(node, app.vault);
	const { concatenatedPart, template, edgeModes } = buildInputWithVariables(
		canvasKey,
		nodeInput,
		incoming,
		settings
	);
	const fullPrompt =
		concatenatedPart.length > 0 ? `${concatenatedPart}\n\n---\n\n${template}` : template;

	if (role === "orange") {
		const model = settings.ollamaOrangeModel || "llama2";
		const temperature = settings.ollamaOrangeTemperature ?? DEFAULT_SETTINGS.ollamaOrangeTemperature;
		const start = performance.now();
		const result = await ollamaGenerate({
			model,
			prompt: fullPrompt,
			stream: false,
			options: { temperature },
		});
		setNodeDuration(canvasKey, nodeId, performance.now() - start);
		setNodeResult(canvasKey, nodeId, result.response);
		ensureOutputNodeAndEdge(data, node, result.response, settings, {
			fullPrompt,
			thinking: result.thinking,
		});
		await updateEdgeLabelsAndSave(app.vault, canvasFilePath, data, nodeId, edgeModes, liveCanvas, runStartData);
		return result.response;
	}
	if (role === "purple") {
		const model = settings.ollamaPurpleModel || "llama2";
		const temperature = settings.ollamaPurpleTemperature ?? DEFAULT_SETTINGS.ollamaPurpleTemperature;
		const start = performance.now();
		const result = await ollamaGenerate({
			model,
			prompt: fullPrompt,
			stream: false,
			options: { temperature },
		});
		setNodeDuration(canvasKey, nodeId, performance.now() - start);
		setNodeResult(canvasKey, nodeId, result.response);
		ensureOutputNodeAndEdge(data, node, result.response, settings, {
			fullPrompt,
			thinking: result.thinking,
		});
		await updateEdgeLabelsAndSave(app.vault, canvasFilePath, data, nodeId, edgeModes, liveCanvas, runStartData);
		return result.response;
	}
	if (role === "red") {
		const model = settings.ollamaRedModel || "llama2";
		const temperature = settings.ollamaRedTemperature ?? DEFAULT_SETTINGS.ollamaRedTemperature;
		const start = performance.now();
		const result = await ollamaGenerate({
			model,
			prompt: fullPrompt,
			stream: false,
			options: { temperature },
		});
		setNodeDuration(canvasKey, nodeId, performance.now() - start);
		setNodeResult(canvasKey, nodeId, result.response);
		ensureOutputNodeAndEdge(data, node, result.response, settings, {
			fullPrompt,
			thinking: result.thinking,
		});
		await updateEdgeLabelsAndSave(app.vault, canvasFilePath, data, nodeId, edgeModes, liveCanvas, runStartData);
		return result.response;
	}
	if (role === "blue") {
		const kernel = getKernelForCanvas(canvasKey, settings.pythonPath);
		const code = stripPythonCodeFence(template);
		const result = await kernel.run(code, concatenatedPart);
		setNodeResult(canvasKey, nodeId, result);
		ensureOutputNodeAndEdge(data, node, result, settings);
		await updateEdgeLabelsAndSave(app.vault, canvasFilePath, data, nodeId, edgeModes, liveCanvas, runStartData);
		return result;
	}
	return "";
}

/** Max horizontal offset (px) for output box collision avoidance; beyond this we allow overlap. */
const OUTPUT_COLLISION_MAX_RADIUS = 500;
/** Step (px) between candidate x positions when avoiding collisions. */
const OUTPUT_COLLISION_STEP = 80;
/** Max vertical offset (px) below default placement when avoiding collisions. */
const OUTPUT_COLLISION_MAX_VERTICAL = 400;
/** Step (px) between candidate y positions when avoiding vertical collisions. */
const OUTPUT_COLLISION_VERTICAL_STEP = 60;
/** Min gap (px) between output box and other nodes; placement avoids coming within this distance. */
const OUTPUT_COLLISION_BUFFER = 24;
/** Step (px) between candidate positions for auxiliary (thinking) node collision avoidance. */
const AUXILIARY_COLLISION_STEP = 60;
/** Max radius (px) from default when searching for a non-overlapping spot for the thinking node. */
const AUXILIARY_COLLISION_MAX_RADIUS = 400;

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

/** Choose (x, y) for the output box to avoid overlapping other nodes. Tries default position, then shifts horizontally, then downward. */
function chooseOutputPositionXY(
	data: CanvasData,
	sourceNodeId: string,
	outNodeId: string | null,
	defaultX: number,
	defaultY: number,
	width: number,
	height: number,
	extraExcludeIds: string[] = []
): { x: number; y: number } {
	const excludeIds = new Set<string>([sourceNodeId]);
	if (outNodeId) excludeIds.add(outNodeId);
	for (const id of extraExcludeIds) excludeIds.add(id);
	const box = { x: 0, y: 0, width, height };
	function tryPosition(x: number, y: number): boolean {
		box.x = x;
		box.y = y;
		for (const node of data.nodes) {
			if (excludeIds.has(node.id)) continue;
			// Expand other node by buffer so we keep at least OUTPUT_COLLISION_BUFFER gap
			const expanded = {
				x: node.x - OUTPUT_COLLISION_BUFFER,
				y: node.y - OUTPUT_COLLISION_BUFFER,
				width: node.width + 2 * OUTPUT_COLLISION_BUFFER,
				height: node.height + 2 * OUTPUT_COLLISION_BUFFER,
			};
			if (rectanglesOverlap(box, expanded)) return false;
		}
		return true;
	}
	for (let dy = 0; dy <= OUTPUT_COLLISION_MAX_VERTICAL; dy += OUTPUT_COLLISION_VERTICAL_STEP) {
		const candidateY = defaultY + dy;
		for (const dx of xOffsets()) {
			if (tryPosition(defaultX + dx, candidateY)) return { x: defaultX + dx, y: candidateY };
		}
	}
	return { x: defaultX, y: defaultY };
}

function* xOffsets(): Generator<number> {
	yield 0;
	for (let offset = OUTPUT_COLLISION_STEP; offset <= OUTPUT_COLLISION_MAX_RADIUS; offset += OUTPUT_COLLISION_STEP) {
		yield offset;
		yield -offset;
	}
}

/** Yields (dx, dy) in ring order: (0,0) first, then ring at step, then 2*step, ... up to max radius. */
function* auxiliaryPositionOffsets(): Generator<{ dx: number; dy: number }> {
	yield { dx: 0, dy: 0 };
	for (let r = AUXILIARY_COLLISION_STEP; r <= AUXILIARY_COLLISION_MAX_RADIUS; r += AUXILIARY_COLLISION_STEP) {
		for (let dx = -r; dx <= r; dx += AUXILIARY_COLLISION_STEP) {
			for (let dy = -r; dy <= r; dy += AUXILIARY_COLLISION_STEP) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				yield { dx, dy };
			}
		}
	}
}

/** Choose (x, y) for the thinking node: prefers default (left of source), then tries positions in all directions to avoid overlap. */
function chooseThinkingNodePositionXY(
	data: CanvasData,
	sourceNodeId: string,
	thinkingNodeId: string | null,
	defaultX: number,
	defaultY: number,
	width: number,
	height: number,
	extraExcludeIds: string[] = []
): { x: number; y: number } {
	const excludeIds = new Set<string>([sourceNodeId]);
	if (thinkingNodeId) excludeIds.add(thinkingNodeId);
	for (const id of extraExcludeIds) excludeIds.add(id);
	const box = { x: 0, y: 0, width, height };
	function tryPosition(x: number, y: number): boolean {
		box.x = x;
		box.y = y;
		for (const node of data.nodes) {
			if (excludeIds.has(node.id)) continue;
			const expanded = {
				x: node.x - OUTPUT_COLLISION_BUFFER,
				y: node.y - OUTPUT_COLLISION_BUFFER,
				width: node.width + 2 * OUTPUT_COLLISION_BUFFER,
				height: node.height + 2 * OUTPUT_COLLISION_BUFFER,
			};
			if (rectanglesOverlap(box, expanded)) return false;
		}
		return true;
	}
	for (const { dx, dy } of auxiliaryPositionOffsets()) {
		if (tryPosition(defaultX + dx, defaultY + dy)) {
			return { x: defaultX + dx, y: defaultY + dy };
		}
	}
	return { x: defaultX, y: defaultY };
}

/** Generate a unique id for new canvas nodes/edges. */
function randomId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return "output-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
}

/** Sides of a node for edge connection (Obsidian canvas). */
type NodeSide = "top" | "right" | "bottom" | "left";

/** Preferred order for auxiliary edges (prompt/thinking): use left/right to avoid input (top) and output (bottom). */
const AUXILIARY_EDGE_SIDE_ORDER: NodeSide[] = ["left", "right", "top", "bottom"];

/** Pick a side of sourceNode that is not already used by edges from/to that node. Used so prompt/thinking connect on a free side. */
function chooseFreeSideForAuxiliaryEdge(data: CanvasData, sourceNodeId: string): NodeSide {
	const used = new Set<NodeSide>();
	for (const e of data.edges) {
		if (e.fromNode === sourceNodeId && e.fromSide) used.add(e.fromSide as NodeSide);
		if (e.toNode === sourceNodeId && e.toSide) used.add(e.toSide as NodeSide);
	}
	for (const side of AUXILIARY_EDGE_SIDE_ORDER) {
		if (!used.has(side)) return side;
	}
	return "left";
}

/** Options for ensureOutputNodeAndEdge: optional prompt and thinking to show in separate nodes. */
interface EnsureOutputOptions {
	fullPrompt?: string;
	thinking?: string;
}

/** Create or replace the Green output node (and optional prompt/thinking nodes) and ensure edges from source. Mutates data only. */
function ensureOutputNodeAndEdge(
	data: CanvasData,
	sourceNode: AllCanvasNodeData,
	text: string,
	settings: ZettelPluginSettings,
	options: EnsureOutputOptions = {}
): void {
	const { fullPrompt, thinking } = options;
	const promptId = findAuxiliaryNodeForSource(data, sourceNode.id, EDGE_LABEL_PROMPT);
	const thinkingId = findAuxiliaryNodeForSource(data, sourceNode.id, EDGE_LABEL_THINKING);
	const outId = findOutputNodeForSource(data, sourceNode.id, settings);

	const defaultY = sourceNode.y + sourceNode.height + GREEN_NODE_PADDING;
	const width = Math.max(320, sourceNode.width);
	const height = 180;
	const defaultX = sourceNode.x;
	const extraExclude = [promptId, thinkingId].filter((id): id is string => id != null);

	const { x: chosenX, y: chosenY } = chooseOutputPositionXY(
		data,
		sourceNode.id,
		outId,
		defaultX,
		defaultY,
		width,
		height,
		extraExclude
	);
	const greenColor = settings.colorGreen;

	// 1. Ensure output node
	let resolvedOutputId: string;
	if (outId) {
		resolvedOutputId = outId;
		const outNode = getNodeById(data, outId);
		if (outNode && isTextNode(outNode)) {
			const existingX = (outNode as CanvasTextData).x;
			const existingY = (outNode as CanvasTextData).y;
			const updated = {
				...(outNode as CanvasTextData),
				text,
				x: existingX,
				y: existingY,
				width,
				height,
			};
			const idx = data.nodes.findIndex((n) => n.id === outId);
			if (idx >= 0) data.nodes[idx] = updated;
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
				fromSide: "bottom",
				toSide: "top",
			});
		}
	} else {
		const newNodeId = randomId();
		resolvedOutputId = newNodeId;
		const newTextNode: CanvasTextData = {
			id: newNodeId,
			type: "text",
			text,
			x: chosenX,
			y: chosenY,
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
			fromSide: "bottom",
			toSide: "top",
		});
	}

	const outputNode = getNodeById(data, resolvedOutputId);
	const outputY = outputNode && "y" in outputNode ? (outputNode as { y: number }).y : chosenY;

	// 2. Ensure thinking node (above output) when setting on and thinking present
	if (settings.showThinkingNode && thinking != null && thinking.length > 0) {
		const thinkingSide = chooseFreeSideForAuxiliaryEdge(data, sourceNode.id);
		const thinkingDefaultX = sourceNode.x - width - GREEN_NODE_PADDING;
		const thinkingDefaultY = sourceNode.y;
		const thinkingExclude = [sourceNode.id, resolvedOutputId, promptId].filter((id): id is string => id != null);
		const { x: tx, y: ty } = chooseThinkingNodePositionXY(
			data,
			sourceNode.id,
			thinkingId,
			thinkingDefaultX,
			thinkingDefaultY,
			width,
			height,
			thinkingExclude
		);
		const thinkingColor = shadeColor(settings.colorGreen, 0.15);

		if (thinkingId) {
			const tn = getNodeById(data, thinkingId);
			if (tn && isTextNode(tn)) {
				const updated = {
					...(tn as CanvasTextData),
					text: thinking,
					width,
					height,
					color: thinkingColor,
				};
				const idx = data.nodes.findIndex((n) => n.id === thinkingId);
				if (idx >= 0) data.nodes[idx] = updated;
			}
			const hasEdge = data.edges.some(
				(e) => e.fromNode === sourceNode.id && e.toNode === thinkingId && parseEdgeVariableName(e.label) === EDGE_LABEL_THINKING
			);
			if (!hasEdge) {
				data.edges.push({
					id: randomId(),
					fromNode: sourceNode.id,
					fromSide: thinkingSide,
					toNode: thinkingId,
					toSide: thinkingSide === "left" ? "right" : thinkingSide === "right" ? "left" : thinkingSide === "top" ? "bottom" : "top",
					label: EDGE_LABEL_THINKING,
				});
			}
		} else {
			const newId = randomId();
			data.nodes.push({
				id: newId,
				type: "text",
				text: thinking,
				x: tx,
				y: ty,
				width,
				height,
				color: thinkingColor,
			} as CanvasTextData);
			data.edges.push({
				id: randomId(),
				fromNode: sourceNode.id,
				fromSide: thinkingSide,
				toNode: newId,
				toSide: thinkingSide === "left" ? "right" : thinkingSide === "right" ? "left" : thinkingSide === "top" ? "bottom" : "top",
				label: EDGE_LABEL_THINKING,
			});
		}
	}

	// 3. Ensure prompt node (above thinking or output) when setting on and fullPrompt present
	if (settings.showPromptInOutput && fullPrompt != null && fullPrompt.length > 0) {
		const promptSide = chooseFreeSideForAuxiliaryEdge(data, sourceNode.id);
		const thinkingNodeId = settings.showThinkingNode && thinking ? findAuxiliaryNodeForSource(data, sourceNode.id, EDGE_LABEL_THINKING) : null;
		const anchorNode = thinkingNodeId ? getNodeById(data, thinkingNodeId) : outputNode;
		const anchorY = anchorNode && "y" in anchorNode ? (anchorNode as { y: number }).y : outputY;
		const promptDefaultY = anchorY - height - GREEN_NODE_PADDING;
		const promptExclude = [sourceNode.id, resolvedOutputId, thinkingId, promptId].filter((id): id is string => id != null);
		const { x: px, y: py } = chooseOutputPositionXY(
			data,
			sourceNode.id,
			promptId,
			defaultX,
			promptDefaultY,
			width,
			height,
			promptExclude
		);
		const promptColor = shadeColor(settings.colorGreen, 0.25);
		const promptToSide = promptSide === "left" ? "right" : promptSide === "right" ? "left" : promptSide === "top" ? "bottom" : "top";

		if (promptId) {
			const pn = getNodeById(data, promptId);
			if (pn && isTextNode(pn)) {
				const updated = {
					...(pn as CanvasTextData),
					text: fullPrompt,
					width,
					height,
					color: promptColor,
				};
				const idx = data.nodes.findIndex((n) => n.id === promptId);
				if (idx >= 0) data.nodes[idx] = updated;
			}
			const hasEdge = data.edges.some(
				(e) => e.fromNode === sourceNode.id && e.toNode === promptId && parseEdgeVariableName(e.label) === EDGE_LABEL_PROMPT
			);
			if (!hasEdge) {
				data.edges.push({
					id: randomId(),
					fromNode: sourceNode.id,
					fromSide: promptSide,
					toNode: promptId,
					toSide: promptToSide,
					label: EDGE_LABEL_PROMPT,
				});
			}
		} else {
			const newId = randomId();
			data.nodes.push({
				id: newId,
				type: "text",
				text: fullPrompt,
				x: px,
				y: py,
				width,
				height,
				color: promptColor,
			} as CanvasTextData);
			data.edges.push({
				id: randomId(),
				fromNode: sourceNode.id,
				fromSide: promptSide,
				toNode: newId,
				toSide: promptToSide,
				label: EDGE_LABEL_PROMPT,
			});
		}
	}
}

/** Run a single node (for "Run Node" command). If parents are not run, runs chain to this node instead. */
export async function runNode(
	app: App,
	settings: ZettelPluginSettings,
	canvasFilePath: string,
	nodeId: string,
	liveCanvas: LiveCanvas | null,
	runStartData?: RunStartCanvasData | null
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
	// #region agent log
	fetch("http://127.0.0.1:7243/ingest/453147b6-6b57-40b4-a769-82c9dd3c5ee7", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "runner.ts:runNode", message: "runNode entry", data: { canvasKey, nodeId, canvasFilePath }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H2-H3" }) }).catch(() => {});
	// #endregion
	for (const pid of parentIds) {
		if (getNodeResult(canvasKey, pid) == null) {
			return runChain(app, settings, canvasFilePath, nodeId, liveCanvas, nodeId, runStartData ?? null);
		}
	}
	try {
		setRunningNodeId(canvasKey, nodeId);
		await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nodeId, liveCanvas, runStartData ?? null);
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	} finally {
		setRunningNodeId(canvasKey, null);
	}
}

const CYCLE_ERROR_MESSAGE = "Execution graph contains a cycle; fix connections and try again.";

/** Run all nodes reachable from any root, in topological order. */
export async function runEntireCanvas(
	app: App,
	settings: ZettelPluginSettings,
	canvasFilePath: string,
	liveCanvas: LiveCanvas | null,
	runStartData?: RunStartCanvasData | null
): Promise<{ ok: boolean; message?: string }> {
	const data = await loadCanvasData(app.vault, canvasFilePath);
	if (!data) return { ok: false, message: "Could not load canvas data." };
	const topo = topologicalOrderFull(data, settings);
	if ("cycle" in topo) return { ok: false, message: CYCLE_ERROR_MESSAGE };
	const order = topo.order;
	const canvasKey = getCanvasKey(canvasFilePath);
	try {
		for (const nid of order) {
			try {
				setRunningNodeId(canvasKey, nid);
				await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nid, liveCanvas, runStartData ?? null);
			} finally {
				setRunningNodeId(canvasKey, null);
			}
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

/** Count output-type node ids in data (toNode of edges labeled output). */
function countOutputNodeIds(data: CanvasData): { count: number; ids: string[] } {
	const ids = [...new Set(data.edges.filter((e) => parseEdgeVariableName(e.label) === EDGE_LABEL_OUTPUT).map((e) => e.toNode))];
	return { count: ids.length, ids };
}

/** Return ordered node IDs for a chain from roots to the given target, or null if no data, no path, or cycle. */
export async function getChainNodeIds(
	app: App,
	settings: ZettelPluginSettings,
	canvasFilePath: string,
	targetNodeId: string
): Promise<string[] | null> {
	const data = await loadCanvasData(app.vault, canvasFilePath);
	if (!data) return null;
	const roots = getRootIds(data);
	const rootsReachingCurrent = roots.filter((r) => canReach(data, r, targetNodeId));
	if (rootsReachingCurrent.length === 0) return null;
	const topo = topologicalOrderToTarget(data, targetNodeId, settings);
	if ("cycle" in topo) return null;
	return topo.order;
}

/** Run chain from roots to the given node.
 * @param displayNodeId - when set (e.g. from "Run node" on a node with unrun parents), show "running" on this node for the whole chain; when unset, show running on each node in order.
 * @param runStartData - canvas state at run start; used to respect deletions and placement since run started (including queued jobs).
 */
export async function runChain(
	app: App,
	settings: ZettelPluginSettings,
	canvasFilePath: string,
	nodeId: string,
	liveCanvas: LiveCanvas | null,
	displayNodeId?: string,
	runStartData?: RunStartCanvasData | null
): Promise<{ ok: boolean; message?: string }> {
	const data = await loadCanvasData(app.vault, canvasFilePath);
	if (!data) return { ok: false, message: "Could not load canvas data." };
	// #region agent log
	const outAtLoad = countOutputNodeIds(data);
	fetch("http://127.0.0.1:7243/ingest/453147b6-6b57-40b4-a769-82c9dd3c5ee7", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "runner.ts:runChain", message: "runChain after load", data: { nodeCount: data.nodes.length, outputCount: outAtLoad.count, outputIds: outAtLoad.ids, targetNodeId: nodeId }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H1" }) }).catch(() => {});
	// #endregion
	const roots = getRootIds(data);
	const rootsReachingCurrent = roots.filter((r) => canReach(data, r, nodeId));
	if (rootsReachingCurrent.length === 0) return { ok: false, message: "No root reaches this node." };
	const topo = topologicalOrderToTarget(data, nodeId, settings);
	if ("cycle" in topo) return { ok: false, message: CYCLE_ERROR_MESSAGE };
	const order = topo.order;
	const orderSet = new Set(order);
	// Remove output/prompt/thinking nodes that belong to nodes outside this chain so a later
	// run chain (e.g. queued job) does not "restore" outputs from a previous chain run.
	const auxiliaryLabels = [EDGE_LABEL_OUTPUT, EDGE_LABEL_PROMPT, EDGE_LABEL_THINKING];
	const toRemove = new Set<string>(
		data.edges
			.filter(
				(e) =>
					auxiliaryLabels.includes(parseEdgeVariableName(e.label)) && !orderSet.has(e.fromNode)
			)
			.map((e) => e.toNode)
	);
	if (toRemove.size > 0) {
		data.nodes = data.nodes.filter((n) => !toRemove.has(n.id));
		data.edges = data.edges.filter((e) => !toRemove.has(e.fromNode) && !toRemove.has(e.toNode));
	}
	const canvasKey = getCanvasKey(canvasFilePath);
	try {
		if (displayNodeId != null) setRunningNodeId(canvasKey, displayNodeId);
		for (const nid of order) {
			try {
				if (displayNodeId == null) setRunningNodeId(canvasKey, nid);
				await runSingleNode(app, settings, canvasKey, canvasFilePath, data, nid, liveCanvas, runStartData ?? null);
			} finally {
				if (displayNodeId == null) setRunningNodeId(canvasKey, null);
			}
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	} finally {
		if (displayNodeId != null) setRunningNodeId(canvasKey, null);
	}
}

/** Remove the Green output node and any prompt/thinking nodes (and their edges) for a given source node; mutates data and saves. */
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
	const promptId = findAuxiliaryNodeForSource(data, sourceNodeId, EDGE_LABEL_PROMPT);
	const thinkingId = findAuxiliaryNodeForSource(data, sourceNodeId, EDGE_LABEL_THINKING);
	const toRemove = new Set<string>([outId, promptId, thinkingId].filter((id): id is string => id != null));
	if (toRemove.size === 0) return;
	data.nodes = data.nodes.filter((n) => !toRemove.has(n.id));
	data.edges = data.edges.filter(
		(e) =>
			!(e.fromNode === sourceNodeId && toRemove.has(e.toNode) && [EDGE_LABEL_OUTPUT, EDGE_LABEL_PROMPT, EDGE_LABEL_THINKING].includes(parseEdgeVariableName(e.label)))
	);
	const liveData = liveCanvas?.getData?.();
	if (liveData?.nodes) mergePreserveUserNodeProps(data, liveData);
	liveCanvas?.setData?.(data);
	if (liveCanvas?.requestSave) liveCanvas.requestSave();
	const saved = await saveCanvasData(vault, canvasFilePath, data);
	if (!saved) new Notice("Failed to save canvas.");
}

/** Remove all Green output, prompt, and thinking nodes and their edges on the canvas; mutates data and saves. */
export async function dismissAllOutput(
	vault: App["vault"],
	canvasFilePath: string,
	liveCanvas: LiveCanvas | null
): Promise<void> {
	const data = await loadCanvasData(vault, canvasFilePath);
	if (!data) return;
	const auxiliaryLabels = [EDGE_LABEL_OUTPUT, EDGE_LABEL_PROMPT, EDGE_LABEL_THINKING];
	const auxiliaryNodeIds = new Set(
		data.edges
			.filter((e) => auxiliaryLabels.includes(parseEdgeVariableName(e.label)))
			.map((e) => e.toNode)
	);
	data.nodes = data.nodes.filter((n) => !auxiliaryNodeIds.has(n.id));
	data.edges = data.edges.filter((e) => !auxiliaryLabels.includes(parseEdgeVariableName(e.label)));
	const liveData = liveCanvas?.getData?.();
	if (liveData?.nodes) mergePreserveUserNodeProps(data, liveData);
	liveCanvas?.setData?.(data);
	if (liveCanvas?.requestSave) liveCanvas.requestSave();
	const saved = await saveCanvasData(vault, canvasFilePath, data);
	// #region agent log
	const reRead = await loadCanvasData(vault, canvasFilePath);
	const outAfterDismiss = reRead ? countOutputNodeIds(reRead) : { count: -1, ids: [] };
	fetch("http://127.0.0.1:7243/ingest/453147b6-6b57-40b4-a769-82c9dd3c5ee7", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "runner.ts:dismissAllOutput", message: "after save, re-read file", data: { saved, outputCountOnFile: outAfterDismiss.count, outputIdsOnFile: outAfterDismiss.ids }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H4" }) }).catch(() => {});
	// #endregion
	if (!saved) new Notice("Failed to save canvas.");
}
