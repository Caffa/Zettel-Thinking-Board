import { describe, it, expect } from "vitest";
import {
	normalizeColor,
	getNodeRole,
	getParentIdsSortedByY,
	getNodeById,
	getIncomingEdgesWithLabels,
	findOutputNodeForSource,
	getSourceNodeForOutputNode,
	isOutputEdge,
	isAuxiliaryEdge,
	parseEdgeVariableName,
	GREEN_NODE_PADDING,
	EDGE_LABEL_INJECTED,
	EDGE_LABEL_CONCATENATED,
	EDGE_LABEL_OUTPUT,
	EDGE_LABEL_PROMPT,
	EDGE_LABEL_THINKING,
} from "./types";
import type { CanvasData } from "./types";
import { DEFAULT_SETTINGS } from "../settings";

describe("normalizeColor", () => {
	it("returns empty string for null and undefined", () => {
		expect(normalizeColor(undefined)).toBe("");
		expect(normalizeColor(null as unknown as undefined)).toBe("");
	});
	it("returns empty string for empty string", () => {
		expect(normalizeColor("")).toBe("");
	});
	it("trims and preserves preset numbers", () => {
		expect(normalizeColor("1")).toBe("1");
		expect(normalizeColor("  2  ")).toBe("2");
	});
	it("lowercases hex colors", () => {
		expect(normalizeColor("#FF0000")).toBe("#ff0000");
		expect(normalizeColor("#abc")).toBe("#abc");
	});
});

describe("getNodeRole", () => {
	const settings = { ...DEFAULT_SETTINGS };

	it("returns null when node has no color", () => {
		expect(getNodeRole({}, settings)).toBeNull();
		expect(getNodeRole({ color: "" }, settings)).toBeNull();
	});
	it("returns role when node color matches setting", () => {
		expect(getNodeRole({ color: "1" }, settings)).toBe("orange");
		expect(getNodeRole({ color: "2" }, settings)).toBe("purple");
		expect(getNodeRole({ color: "5" }, settings)).toBe("red");
		expect(getNodeRole({ color: "6" }, settings)).toBe("blue");
		expect(getNodeRole({ color: "3" }, settings)).toBe("yellow");
		expect(getNodeRole({ color: "4" }, settings)).toBe("green");
		expect(getNodeRole({ color: "#00bcd4" }, settings)).toBe("cyan");
		expect(getNodeRole({ color: "#e91e63" }, settings)).toBe("pink");
	});
	it("returns null when role color is disabled (empty)", () => {
		const disabledBlue = { ...DEFAULT_SETTINGS, colorBlue: "" };
		expect(getNodeRole({ color: "6" }, disabledBlue)).toBeNull();
	});
	it("returns null when color does not match any setting", () => {
		expect(getNodeRole({ color: "99" }, settings)).toBeNull();
	});
});

describe("parseEdgeVariableName", () => {
	it("returns empty for undefined or empty", () => {
		expect(parseEdgeVariableName(undefined)).toBe("");
		expect(parseEdgeVariableName("")).toBe("");
	});
	it("returns label trimmed when no suffix", () => {
		expect(parseEdgeVariableName("summary")).toBe("summary");
		expect(parseEdgeVariableName("  out1  ")).toBe("out1");
	});
	it("strips (injected) and (concatenated) suffixes", () => {
		expect(parseEdgeVariableName("summary" + EDGE_LABEL_INJECTED)).toBe("summary");
		expect(parseEdgeVariableName("out1" + EDGE_LABEL_CONCATENATED)).toBe("out1");
	});
	it("strips any trailing parenthesized segment", () => {
		expect(parseEdgeVariableName("foo (bar)")).toBe("foo");
		expect(parseEdgeVariableName("draft (WIP)")).toBe("draft");
	});
});

describe("isOutputEdge", () => {
	it("returns true when label parses to output", () => {
		expect(isOutputEdge({ id: "e", fromNode: "a", toNode: "b", label: EDGE_LABEL_OUTPUT })).toBe(true);
		expect(isOutputEdge({ id: "e", fromNode: "a", toNode: "b", label: "  output  " })).toBe(true);
	});
	it("returns false for variable edges", () => {
		expect(isOutputEdge({ id: "e", fromNode: "a", toNode: "b", label: "age" })).toBe(false);
		expect(isOutputEdge({ id: "e", fromNode: "a", toNode: "b", label: "summary (injected)" })).toBe(false);
	});
	it("returns false for empty or undefined label", () => {
		expect(isOutputEdge({ id: "e", fromNode: "a", toNode: "b" })).toBe(false);
		expect(isOutputEdge({ id: "e", fromNode: "a", toNode: "b", label: "" })).toBe(false);
	});
});

describe("isAuxiliaryEdge", () => {
	it("returns true for output, prompt, and thinking labels", () => {
		expect(isAuxiliaryEdge({ id: "e", fromNode: "a", toNode: "b", label: EDGE_LABEL_OUTPUT })).toBe(true);
		expect(isAuxiliaryEdge({ id: "e", fromNode: "a", toNode: "b", label: EDGE_LABEL_PROMPT })).toBe(true);
		expect(isAuxiliaryEdge({ id: "e", fromNode: "a", toNode: "b", label: EDGE_LABEL_THINKING })).toBe(true);
	});
	it("returns false for variable edges", () => {
		expect(isAuxiliaryEdge({ id: "e", fromNode: "a", toNode: "b", label: "age" })).toBe(false);
	});
});

describe("getIncomingEdgesWithLabels", () => {
	it("returns incoming edges with variable names sorted by parent y", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "a", x: 0, y: 100, width: 100, height: 50, type: "text", text: "" },
				{ id: "b", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "c", x: 0, y: 50, width: 100, height: 50, type: "text", text: "" },
			],
			edges: [
				{ id: "e1", fromNode: "b", fromSide: "bottom", toNode: "a", toSide: "top", label: "first" },
				{ id: "e2", fromNode: "c", fromSide: "bottom", toNode: "a", toSide: "top", label: "second" },
			],
		};
		const result = getIncomingEdgesWithLabels("a", data);
		expect(result).toHaveLength(2);
		const first = result[0];
		const second = result[1];
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(first!.parentId).toBe("b");
		expect(first!.variableName).toBe("first");
		expect(second!.parentId).toBe("c");
		expect(second!.variableName).toBe("second");
	});
	it("returns empty array when node has no incoming edges", () => {
		const data: CanvasData = {
			nodes: [{ id: "a", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" }],
			edges: [],
		};
		expect(getIncomingEdgesWithLabels("a", data)).toEqual([]);
	});
	it("excludes edges with label output", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "a", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "b", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "out", x: 0, y: 70, width: 100, height: 50, type: "text", text: "", color: "5" },
			],
			edges: [
				{ id: "e1", fromNode: "b", toNode: "a", label: "age" },
				{ id: "e2", fromNode: "a", toNode: "out", label: EDGE_LABEL_OUTPUT },
			],
		};
		const result = getIncomingEdgesWithLabels("a", data);
		expect(result).toHaveLength(1);
		expect(result[0]?.parentId).toBe("b");
		expect(result[0]?.variableName).toBe("age");
	});
	it("sorts by parent y then x (left-most first when same y)", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "a", x: 0, y: 100, width: 100, height: 50, type: "text", text: "" },
				{ id: "b", x: 200, y: 50, width: 100, height: 50, type: "text", text: "" },
				{ id: "c", x: 100, y: 50, width: 100, height: 50, type: "text", text: "" },
			],
			edges: [
				{ id: "e1", fromNode: "b", toNode: "a", label: "right" },
				{ id: "e2", fromNode: "c", toNode: "a", label: "mid" },
			],
		};
		const result = getIncomingEdgesWithLabels("a", data);
		expect(result).toHaveLength(2);
		expect(result[0]!.parentId).toBe("c");
		expect(result[0]!.variableName).toBe("mid");
		expect(result[1]!.parentId).toBe("b");
		expect(result[1]!.variableName).toBe("right");
	});
	it("treats connection to green output node as connection to its source", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "run", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "out", x: 0, y: 60, width: 100, height: 50, type: "text", text: "" },
				{ id: "b", x: 0, y: 120, width: 100, height: 50, type: "text", text: "" },
			],
			edges: [
				{ id: "eOut", fromNode: "run", toNode: "out", label: EDGE_LABEL_OUTPUT },
				{ id: "eToB", fromNode: "out", toNode: "b", label: "summary" },
			],
		};
		const result = getIncomingEdgesWithLabels("b", data);
		expect(result).toHaveLength(1);
		expect(result[0]!.parentId).toBe("run");
		expect(result[0]!.variableName).toBe("summary");
	});
});

describe("getParentIdsSortedByY", () => {
	it("returns parent ids sorted by y ascending", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "a", x: 0, y: 100, width: 100, height: 50, type: "text", text: "" },
				{ id: "b", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "c", x: 0, y: 50, width: 100, height: 50, type: "text", text: "" },
			],
			edges: [
				{ id: "e1", fromNode: "b", fromSide: "bottom", toNode: "a", toSide: "top" },
				{ id: "e2", fromNode: "c", fromSide: "bottom", toNode: "a", toSide: "top" },
			],
		};
		expect(getParentIdsSortedByY("a", data)).toEqual(["b", "c"]);
	});
	it("returns empty array when node has no parents", () => {
		const data: CanvasData = {
			nodes: [{ id: "a", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" }],
			edges: [],
		};
		expect(getParentIdsSortedByY("a", data)).toEqual([]);
	});
	it("excludes edges with label output", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "a", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "out", x: 0, y: 70, width: 100, height: 50, type: "text", text: "", color: "5" },
			],
			edges: [
				{ id: "e1", fromNode: "a", toNode: "out", label: EDGE_LABEL_OUTPUT },
			],
		};
		expect(getParentIdsSortedByY("out", data)).toEqual([]);
	});
	it("treats connection from green output node as connection from its source", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "run", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "out", x: 0, y: 60, width: 100, height: 50, type: "text", text: "" },
				{ id: "b", x: 0, y: 120, width: 100, height: 50, type: "text", text: "" },
			],
			edges: [
				{ id: "eOut", fromNode: "run", toNode: "out", label: EDGE_LABEL_OUTPUT },
				{ id: "eToB", fromNode: "out", toNode: "b", label: "x" },
			],
		};
		expect(getParentIdsSortedByY("b", data)).toEqual(["run"]);
	});
});

describe("getNodeById", () => {
	it("returns node when found", () => {
		const data: CanvasData = {
			nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "hi" }],
			edges: [],
		};
		expect(getNodeById(data, "n1")?.id).toBe("n1");
	});
	it("returns undefined when not found", () => {
		const data: CanvasData = { nodes: [], edges: [] };
		expect(getNodeById(data, "missing")).toBeUndefined();
	});
});

describe("findOutputNodeForSource", () => {
	const settings = { ...DEFAULT_SETTINGS, colorGreen: "5" };

	it("returns null when source node not found", () => {
		const data: CanvasData = { nodes: [], edges: [] };
		expect(findOutputNodeForSource(data, "missing", settings)).toBeNull();
	});
	it("returns green node id when it sits below source within tolerance", () => {
		const sourceY = 100;
		const greenY = sourceY + 50 + GREEN_NODE_PADDING; // 170
		const data: CanvasData = {
			nodes: [
				{ id: "src", x: 10, y: sourceY, width: 200, height: 50, type: "text", text: "", color: "1" },
				{ id: "out", x: 10, y: greenY, width: 200, height: 100, type: "text", text: "", color: "5" },
			],
			edges: [],
		};
		expect(findOutputNodeForSource(data, "src", settings)).toBe("out");
	});
	it("returns null when no green node in expected position", () => {
		const data: CanvasData = {
			nodes: [{ id: "src", x: 0, y: 0, width: 100, height: 50, type: "text", text: "", color: "1" }],
			edges: [],
		};
		expect(findOutputNodeForSource(data, "src", settings)).toBeNull();
	});
	it("returns toNode when edge from source has label output", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "src", x: 0, y: 0, width: 100, height: 50, type: "text", text: "", color: "1" },
				{ id: "out", x: 0, y: 200, width: 100, height: 50, type: "text", text: "", color: "5" },
			],
			edges: [
				{ id: "e1", fromNode: "src", toNode: "out", label: EDGE_LABEL_OUTPUT },
			],
		};
		expect(findOutputNodeForSource(data, "src", settings)).toBe("out");
	});
});

describe("getSourceNodeForOutputNode", () => {
	it("returns fromNode of edge with label output when toNode is given", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "run", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "out", x: 0, y: 60, width: 100, height: 50, type: "text", text: "" },
			],
			edges: [
				{ id: "e1", fromNode: "run", toNode: "out", label: EDGE_LABEL_OUTPUT },
			],
		};
		expect(getSourceNodeForOutputNode(data, "out")).toBe("run");
	});
	it("returns null when node is not the target of an output edge", () => {
		const data: CanvasData = {
			nodes: [
				{ id: "a", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
				{ id: "b", x: 0, y: 60, width: 100, height: 50, type: "text", text: "" },
			],
			edges: [
				{ id: "e1", fromNode: "a", toNode: "b", label: "summary" },
			],
		};
		expect(getSourceNodeForOutputNode(data, "b")).toBeNull();
	});
	it("returns null when node id is missing", () => {
		const data: CanvasData = { nodes: [], edges: [] };
		expect(getSourceNodeForOutputNode(data, "missing")).toBeNull();
	});
});

describe("GREEN_NODE_PADDING", () => {
	it("equals 20", () => {
		expect(GREEN_NODE_PADDING).toBe(20);
	});
});
