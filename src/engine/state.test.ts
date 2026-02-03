import { describe, it, expect, beforeEach } from "vitest";
import {
	getCanvasKey,
	getNodeResult,
	setNodeResult,
	getEdgeMode,
	setEdgeModes,
	clearCanvasState,
} from "./state";

beforeEach(() => {
	clearCanvasState("/c.md");
	clearCanvasState("/a.md");
	clearCanvasState("/b.md");
	clearCanvasState("/c1.md");
	clearCanvasState("/c2.md");
});

describe("getCanvasKey", () => {
	it("returns the file path as-is", () => {
		expect(getCanvasKey("/path/to/canvas.md")).toBe("/path/to/canvas.md");
		expect(getCanvasKey("canvas.md")).toBe("canvas.md");
	});
});

describe("getNodeResult / setNodeResult", () => {
	it("returns undefined when no result set", () => {
		expect(getNodeResult("/c.md", "node1")).toBeUndefined();
	});
	it("returns set result after setNodeResult", () => {
		setNodeResult("/c.md", "node1", "hello");
		expect(getNodeResult("/c.md", "node1")).toBe("hello");
	});
	it("isolates state per canvas key", () => {
		setNodeResult("/a.md", "n1", "a1");
		setNodeResult("/b.md", "n1", "b1");
		expect(getNodeResult("/a.md", "n1")).toBe("a1");
		expect(getNodeResult("/b.md", "n1")).toBe("b1");
	});
});

describe("clearCanvasState", () => {
	it("removes all node results for that canvas", () => {
		setNodeResult("/c.md", "n1", "x");
		clearCanvasState("/c.md");
		expect(getNodeResult("/c.md", "n1")).toBeUndefined();
	});
	it("does not affect other canvases", () => {
		setNodeResult("/c1.md", "n1", "v1");
		setNodeResult("/c2.md", "n1", "v2");
		clearCanvasState("/c1.md");
		expect(getNodeResult("/c2.md", "n1")).toBe("v2");
	});
	it("clears edge modes for that canvas", () => {
		setEdgeModes("/c.md", new Map([["e1", "inject"]]));
		expect(getEdgeMode("/c.md", "e1")).toBe("inject");
		clearCanvasState("/c.md");
		expect(getEdgeMode("/c.md", "e1")).toBeUndefined();
	});
});
