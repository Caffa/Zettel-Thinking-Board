/** Per-canvas state: NodeID -> last output result string. */
const canvasState = new Map<string, Map<string, string>>();

/** Per-canvas edge mode: EdgeID -> "inject" | "concatenate" (shown in floating label under edge). */
const edgeModeState = new Map<string, Map<string, "inject" | "concatenate">>();

/** Node currently running (waiting for AI/kernel) per canvas; used to show "running" on incoming edges. */
const runningNodeState = new Map<string, string | null>();

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
	runningNodeState.delete(canvasKey);
}

/** Canvas key = file path for the canvas file. */
export function getCanvasKey(filePath: string): string {
	return filePath;
}
