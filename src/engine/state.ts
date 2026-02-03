/** Per-canvas state: NodeID -> last output result string. */
const canvasState = new Map<string, Map<string, string>>();

function getCanvasState(canvasKey: string): Map<string, string> {
	let map = canvasState.get(canvasKey);
	if (!map) {
		map = new Map();
		canvasState.set(canvasKey, map);
	}
	return map;
}

export function getNodeResult(canvasKey: string, nodeId: string): string | undefined {
	return getCanvasState(canvasKey).get(nodeId);
}

export function setNodeResult(canvasKey: string, nodeId: string, result: string): void {
	getCanvasState(canvasKey).set(nodeId, result);
}

export function clearCanvasState(canvasKey: string): void {
	canvasState.delete(canvasKey);
}

/** Canvas key = file path for the canvas file. */
export function getCanvasKey(filePath: string): string {
	return filePath;
}
