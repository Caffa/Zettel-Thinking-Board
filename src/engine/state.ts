/** Per-canvas state: NodeID -> last output result string. */
const canvasState = new Map<string, Map<string, string>>();

/** Per-canvas edge mode: EdgeID -> "inject" | "concatenate" (shown in floating label under edge). */
const edgeModeState = new Map<string, Map<string, "inject" | "concatenate">>();

/** Node currently running (waiting for AI/kernel) per canvas; used to show "running" on incoming edges. */
const runningNodeState = new Map<string, string | null>();

/** Per-canvas AI node duration: NodeID -> duration in milliseconds. */
const nodeDurationState = new Map<string, Map<string, number>>();

/** Global lock: only one run (node/chain/entire) at a time across all canvases. */
let runInProgress = false;

/** Canvas state at run start (first job in session), per canvas; used to respect deletions and placement since run started. */
export type RunStartCanvasData = { nodes: Array<{ id: string }> } | null;
const runStartByCanvas = new Map<string, RunStartCanvasData>();

/** Run queue: jobs waiting to run. */
export type RunQueueJob =
	| { type: "node"; canvasFilePath: string; nodeId: string }
	| { type: "chain"; canvasFilePath: string; nodeId: string }
	| { type: "entire"; canvasFilePath: string };

const runQueue: RunQueueJob[] = [];

/** Per-canvas set of node IDs that are the target of a queued job (for "queued" indicator). */
const queuedNodeIdsState = new Map<string, Set<string>>();

function getCanvasState(canvasKey: string): Map<string, string> {
	let map = canvasState.get(canvasKey);
	if (!map) {
		map = new Map();
		canvasState.set(canvasKey, map);
	}
	return map;
}

function getEdgeModeState(canvasKey: string): Map<string, "inject" | "concatenate"> {
	let map = edgeModeState.get(canvasKey);
	if (!map) {
		map = new Map();
		edgeModeState.set(canvasKey, map);
	}
	return map;
}

function getNodeDurationState(canvasKey: string): Map<string, number> {
	let map = nodeDurationState.get(canvasKey);
	if (!map) {
		map = new Map();
		nodeDurationState.set(canvasKey, map);
	}
	return map;
}

export function getNodeResult(canvasKey: string, nodeId: string): string | undefined {
	return getCanvasState(canvasKey).get(nodeId);
}

export function setNodeResult(canvasKey: string, nodeId: string, result: string): void {
	getCanvasState(canvasKey).set(nodeId, result);
}

export function getEdgeMode(canvasKey: string, edgeId: string): "inject" | "concatenate" | undefined {
	return getEdgeModeState(canvasKey).get(edgeId);
}

export function setEdgeModes(canvasKey: string, modes: Map<string, "inject" | "concatenate">): void {
	const state = getEdgeModeState(canvasKey);
	for (const [edgeId, mode] of modes) state.set(edgeId, mode);
}

export function getNodeDuration(canvasKey: string, nodeId: string): number | undefined {
	return getNodeDurationState(canvasKey).get(nodeId);
}

export function setNodeDuration(canvasKey: string, nodeId: string, durationMs: number): void {
	getNodeDurationState(canvasKey).set(nodeId, durationMs);
}

export function getRunningNodeId(canvasKey: string): string | null {
	return runningNodeState.get(canvasKey) ?? null;
}

export function setRunningNodeId(canvasKey: string, nodeId: string | null): void {
	if (nodeId == null) runningNodeState.delete(canvasKey);
	else runningNodeState.set(canvasKey, nodeId);
}

export function clearCanvasState(canvasKey: string): void {
	canvasState.delete(canvasKey);
	edgeModeState.delete(canvasKey);
	nodeDurationState.delete(canvasKey);
	runningNodeState.delete(canvasKey);
	queuedNodeIdsState.delete(canvasKey);
}

export function getRunInProgress(): boolean {
	return runInProgress;
}

export function setRunInProgress(value: boolean): void {
	runInProgress = value;
}

export function setRunStartCanvasData(canvasKey: string, data: RunStartCanvasData): void {
	if (data == null) runStartByCanvas.delete(canvasKey);
	else runStartByCanvas.set(canvasKey, data);
}

export function getRunStartCanvasData(canvasKey: string): RunStartCanvasData {
	return runStartByCanvas.get(canvasKey) ?? null;
}

/** Clear all run-start data (e.g. when run session ends). */
export function clearRunStartCanvasData(): void {
	runStartByCanvas.clear();
}

export function enqueueRun(job: RunQueueJob): void {
	runQueue.push(job);
	// Only add single nodeId for "node" jobs; "chain" jobs add all chain nodes via addQueuedNodeIds in main.
	if (job.type === "node" && "nodeId" in job && job.nodeId != null) {
		const key = getCanvasKey(job.canvasFilePath);
		let set = queuedNodeIdsState.get(key);
		if (!set) {
			set = new Set();
			queuedNodeIdsState.set(key, set);
		}
		set.add(job.nodeId);
	}
}

/** Add node IDs to the queued set for a canvas (e.g. all nodes in a queued chain). */
export function addQueuedNodeIds(canvasKey: string, nodeIds: Iterable<string>): void {
	let set = queuedNodeIdsState.get(canvasKey);
	if (!set) {
		set = new Set();
		queuedNodeIdsState.set(canvasKey, set);
	}
	for (const id of nodeIds) set.add(id);
}

/** Remove node IDs from the queued set for a canvas (e.g. when a chain job starts running). */
export function removeQueuedNodeIds(canvasKey: string, nodeIds: Iterable<string>): void {
	const set = queuedNodeIdsState.get(canvasKey);
	if (!set) return;
	for (const id of nodeIds) set.delete(id);
	if (set.size === 0) queuedNodeIdsState.delete(canvasKey);
}

export function dequeueRun(): RunQueueJob | null {
	const job = runQueue.shift() ?? null;
	// Only remove single nodeId for "node" jobs; "chain" jobs remove all chain nodes via removeQueuedNodeIds in main.
	if (job && job.type === "node" && "nodeId" in job && job.nodeId != null) {
		const key = getCanvasKey(job.canvasFilePath);
		const set = queuedNodeIdsState.get(key);
		if (set) {
			set.delete(job.nodeId);
			if (set.size === 0) queuedNodeIdsState.delete(key);
		}
	}
	return job;
}

export function getQueuedNodeIds(canvasKey: string): ReadonlySet<string> {
	return queuedNodeIdsState.get(canvasKey) ?? new Set();
}

/** Clear run queue and run-in-progress flag (e.g. on plugin unload). */
export function clearRunQueue(): void {
	runInProgress = false;
	runQueue.length = 0;
	queuedNodeIdsState.clear();
	runStartByCanvas.clear();
}

/** Canvas key = file path for the canvas file. */
export function getCanvasKey(filePath: string): string {
	return filePath;
}
