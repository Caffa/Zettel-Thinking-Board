import type {CanvasData} from "../canvas/types";

/** Example 1: Basic Concatenation — Multiple inputs automatically combine. */
export function getExample1CanvasData(): CanvasData {
	return {
		nodes: [
			{
				id: "group-concat",
				type: "group",
				x: 30,
				y: 30,
				width: 720,
				height: 520,
				label: "Workflow 1: Concatenation (default)",
			},
			{
				id: "yellow-observation",
				type: "text",
				text: "Observation: Users struggle to find related notes in large vaults.",
				x: 50,
				y: 100,
				width: 300,
				height: 80,
				color: "3",
			},
			{
				id: "yellow-constraint",
				type: "text",
				text: "Constraint: Must work without external plugins or APIs.",
				x: 400,
				y: 100,
				width: 300,
				height: 80,
				color: "3",
			},
			{
				id: "orange-5whys",
				type: "text",
				text: "Apply the 5 Whys framework to analyze the root cause of the problem described above.",
				x: 200,
				y: 240,
				width: 350,
				height: 120,
				color: "1",
			},
			{
				id: "note-concat-explanation",
				type: "text",
				text: "💡 How it works:\n\nBoth Yellow nodes are automatically CONCATENATED (joined with \\n\\n) before being passed to the Orange node.\n\nNo edge labels needed — this is the default behavior.",
				x: 50,
				y: 400,
				width: 650,
				height: 130,
				color: "",
			},
		],
		edges: [
			{ id: "edge-obs-5whys", fromNode: "yellow-observation", toNode: "orange-5whys" },
			{ id: "edge-constraint-5whys", fromNode: "yellow-constraint", toNode: "orange-5whys" },
		],
	};
}
