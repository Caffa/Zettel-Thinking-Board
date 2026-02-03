/** Minimal interface for live canvas mutations (add text node, remove node, save). */
export interface LiveCanvas {
	createTextNode(options: {
		text: string;
		pos: { x: number; y: number };
		size: { width: number; height: number };
		save?: boolean;
		focus?: boolean;
	}): { id: string; x: number; y: number; width: number; height: number; moveTo: (pos: { x: number; y: number }) => void; resize: (size: { width: number; height: number }) => void };
	addNode(node: unknown): void;
	requestSave?: () => void;
	removeNode?(node: unknown): void;
	nodes?: Map<string, unknown> | Iterable<unknown>;
}
