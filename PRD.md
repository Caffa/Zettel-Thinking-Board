# Part 1: Product Requirement Document (PRD)

**Project Name:** Zettel Thinking Board
**Platform:** Obsidian (Desktop)
**Version:** 1.0.0
**Status:** Requirements Finalized

## 1. Executive Summary
**Zettel Thinking Board** transforms the Obsidian Canvas into an interactive AI workbench. It allows users to create chains of thought using LLMs and Python scripts. Unlike traditional flow-based tools, the execution logic flows directly between prompt/code nodes, while the output is visualized as detached "sidecar" notes, keeping the logic graph clean and readable.

## 2. Core Philosophy
*   **Logic over Layout:** Connections define the data flow (e.g., Prompt -> Code). Visual outputs (Green nodes) are artifacts, not dependencies.
*   **Invisible Data Passing:** Node A passes its result to Node B internally in memory, regardless of whether a visual output node exists.
*   **Stateful Intelligence:** A persistent Python kernel **per canvas** allows for variable retention across different nodes in the same graph; each open canvas has its own kernel, which is torn down when the canvas is closed.

## 3. Functional Requirements

### 3.1. Node Logic & Routing (The Color System)
The plugin parses colors to determine behavior.
*   **Orange Node (Primary LLM):** Sends input + parent context to the mapped "Orange" Ollama model.
*   **Purple Node (Secondary LLM):** Sends input + parent context to the mapped "Purple" Ollama model.
*   **Blue Node (Python):** Executes code.
    *   *Input:* `input` variable contains the result string from the parent node.
    *   *State:* Access to shared global variables from previous Blue nodes.
*   **Yellow Node (Comment/Pass-through):**
    *   No execution.
    *   Passes its text context to the next node (useful for static instructions or delimiters).
*   **Green Node (Visual Output):**
    *   **Behavior:** Generated automatically upon successful execution of an Orange, Purple, or Blue node.
    *   **Placement:** Spawned immediately *below* the source node (Coords: $X_{parent}, Y_{parent} + Height_{parent} + Padding$).
    *   **Connectivity:** **Not connected.** It is a visual reference only. It is not part of the logic chain.

### 3.2. Execution Engine
*   **Internal State Manager:** The plugin must maintain a temporary dictionary mapping `NodeID -> LastOutputResult`.
    *   When Node B runs, it looks at its incoming arrow from Node A.
    *   It retrieves Node A's result from the internal dictionary (not by reading a Green node).
*   **Ollama Integration:** Connects to local instance (default `localhost:11434`).
*   **Python Kernel:**
    *   **One kernel per canvas:** A persistent child process is created when a canvas is opened and terminated when that canvas is closed; switching canvases uses (or creates) the kernel for the active canvas.
    *   Standard Input/Output bridge.
    *   **Side Channel:** `obsidian_log()` for debugging to Side Panel.

### 3.3. Workflow Example
1.  **Orange Node** connects to **Blue Node**.
2.  User runs Orange Node.
    *   Result is saved in memory.
    *   Green Node appears below Orange Node with the text.
3.  User runs Blue Node.
    *   Blue Node grabs the saved result from Orange Node memory.
    *   Executes Python.
    *   Result saved in memory.
    *   Green Node appears below Blue Node.

### 3.4. Execution Triggers
*   **Run Node:** Executes the specific node. Requires parent data to be present in memory.
*   **Run Chain (Recursive):**
    *   Backtracks to find the root.
    *   Executes in sequence (Root -> Child -> Grandchild).
    *   Updates/Spawns Green sidecar nodes at every step.

## 4. User Interface (UI)

### 4.1. Side Panel (Zettel Controls)
*   **Model Mapping:** Dropdowns for Orange/Purple -> Ollama Models.
*   **Kernel Controls:** Restart Python Kernel button.
*   **Console:** Log output from `obsidian_log()`.
*   **Environment Variables:** UI to set Global Keys (API Keys, etc).

### 4.2. Canvas UX
*   **Auto-Layout:** When a Green node is spawned, ensure it doesn't perfectly overlap existing nodes (simple collision check or just strictly placing it below).
*   **Context Menu:** Right-click on node -> "Run Node", "Run Chain", "Dismiss Output" (Deletes the attached Green node).

