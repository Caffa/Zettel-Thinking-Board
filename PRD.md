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
*   **Yellow Node (Text / input):**
    *   No execution.
    *   Passes its text as input to the next node (pass-through). Uncolored or unused-color nodes are not connected to any node and do not add to the prompt.
*   **Green Node (Visual Output):**
    *   **Behavior:** Generated automatically upon successful execution of an Orange, Purple, or Blue node. Re-running the source node **replaces** the green note's content (no duplicate output notes).
    *   **Placement:** Spawned immediately *below* the source node (Coords: $X_{parent}, Y_{parent} + Height_{parent} + Padding$).
    *   **Connectivity:** An edge runs from the run node to the green output note, labeled **`output`**. This label is **reserved** (not a variable name). **Run Node** and **Run Chain** ignore edges labeled `output` when building the execution graph—green notes are not children and do not affect traversal.

### 3.2. Edge Variable Injection (Optional)
*   **Default behavior:** Parent outputs are concatenated in order, then `---` and the current node's content (or, for Blue nodes, parent context as system/input and node content as code).
*   **Variable name on edge:** The user may put a **variable name** on an edge (the edge's label in the canvas). This names the parent's output for the target node.
*   **Placeholder in note:** In the target node's content, the user may write `{{var:variableName}}`. At run time, that placeholder is replaced by the corresponding parent's output.
*   **Inject vs concatenate:** If the target note uses `{{var:variableName}}` for a given edge's variable, that parent's output is **injected** at that placeholder and **not** concatenated. If the variable is not used (or the edge has no label), the parent's output is **concatenated** as before.
*   **Edge label after run:** When a node is run, incoming edges that have a variable name (and are not the reserved `output` edge) are updated to show how they were used: the label becomes `variableName (injected)` or `variableName (concatenated)`, so the user can see at a glance which edges were variable-injected vs concatenated.

### 3.3. Execution Engine
*   **Internal State Manager:** The plugin must maintain a temporary dictionary mapping `NodeID -> LastOutputResult`.
    *   When Node B runs, it looks at its incoming arrow from Node A.
    *   It retrieves Node A's result from the internal dictionary (not by reading a Green node).
*   **Ollama Integration:** Connects to local instance (default `localhost:11434`).
*   **Python Kernel:**
    *   **One kernel per canvas:** A persistent child process is created when a canvas is opened and terminated when that canvas is closed; switching canvases uses (or creates) the kernel for the active canvas.
    *   Standard Input/Output bridge.
    *   **Side Channel:** `obsidian_log()` for debugging to Side Panel.

### 3.4. Workflow Example
1.  **Orange Node** connects to **Blue Node**.
2.  User runs Orange Node.
    *   Result is saved in memory.
    *   Green Node appears below Orange Node with the text.
3.  User runs Blue Node.
    *   Blue Node grabs the saved result from Orange Node memory.
    *   Executes Python.
    *   Result saved in memory.
    *   Green Node appears below Blue Node.

### 3.5. Execution Triggers
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

## 5. Canvas Templates

### 5.1. Template Management
*   **Template Folder:** Users can configure a folder in settings to store canvas templates (e.g., `Templates/Canvases`).
*   **Output Folder:** Users can configure a separate folder where new canvases created from templates will be saved (e.g., `Canvases`).
*   **Template Discovery:** The plugin automatically discovers all `.canvas` files within the template folder (including subfolders).
*   **Visual Indicator:** When viewing a canvas in the template folder, a "📋 Template Canvas" banner appears in the top-right corner.

### 5.2. Creating and Managing Templates

#### 5.2.1. Duplicate Canvas Template
*   **Command:** "Duplicate canvas template" opens a modal displaying all available templates.
*   **Template Selection:** User selects a template from the list (showing template name and path).
*   **Duplication:** The plugin creates a complete copy of the selected template canvas in the output folder.
*   **Auto-naming:** New canvas files are automatically named based on the template name with numeric suffixes to avoid conflicts (e.g., `Research Template`, `Research Template 1`, `Research Template 2`).
*   **Auto-open:** After creation, the new canvas is automatically opened in the workspace.

#### 5.2.2. Save Canvas as Template
*   **Command:** "Save canvas as template" (available only when a canvas is active).
*   **Function:** Creates a copy of the current canvas in the template folder.
*   **Use Case:** Quickly save a working canvas as a reusable template without manual file operations.

#### 5.2.3. Edit Canvas Template
*   **Command:** "Edit canvas template" opens a modal displaying all available templates.
*   **Template Selection:** User selects a template from the list.
*   **Opens Template:** The selected template canvas is opened for editing.
*   **Visual Feedback:** Template banner appears to indicate you're editing a template.

### 5.3. Use Cases
*   **Workflow Templates:** Users can create reusable canvas workflows (e.g., research pipeline, data analysis, content generation) and quickly instantiate them for different projects.
*   **Prompt Libraries:** Store canvas templates with pre-configured prompt chains and variable injection patterns for common tasks.
*   **Project Kickstarters:** Create standardized canvas structures for different types of projects, complete with pre-configured model roles and node arrangements.
*   **Template Iteration:** Edit templates directly to refine workflows, then duplicate them for new projects.

## 6. Installation & Dependencies

### 6.1. Dependency Management
*   **Installation Section:** A dedicated section in settings for managing dependencies (Python, Ollama) and recommended models.
*   **Status Checks:** Buttons to check installation status of Python and Ollama, showing version info when installed.
*   **Installation Instructions:** Direct links to installation pages and platform-specific instructions via notices.
*   **Service Management:** Button to start Ollama service if installed but not running.

### 6.2. Recommended Models
The plugin recommends three specific Ollama models optimized for different tasks:

#### 6.2.1. gemma3:4b (3.3 GB)
*   **Purpose:** Text cleaning and quick processing
*   **Use Case:** Fast, lightweight model for simple tasks like text formatting, cleaning, and basic transformations
*   **Configuration:** Ideal for primary or secondary model slot when speed is prioritized

#### 6.2.2. gemma3:27b (17 GB)
*   **Purpose:** Conversation and complex reasoning
*   **Use Case:** Large, high-quality model for detailed responses, complex conversations, and nuanced understanding
*   **Configuration:** Ideal for primary model slot when quality is prioritized

#### 6.2.3. deepseek-r1:32b (19 GB)
*   **Purpose:** Logical text breakdown and analysis
*   **Use Case:** Advanced reasoning model for complex analysis, logical reasoning, structured thinking, and multi-step problem solving
*   **Configuration:** Ideal for tertiary model slot for specialized analytical tasks

### 6.3. Model Download UI
*   **Check Status:** Button to verify if each recommended model is already installed
*   **Download:** One-click download button that runs `ollama pull <model>` in background
*   **Progress Feedback:** Status indicators showing download progress and completion
*   **Post-Download:** Automatic status update to show successful installation

### 6.4. Desktop-Only Features
*   All dependency checks and installation helpers require Obsidian desktop app (not available on mobile)
*   Uses Node.js `child_process` module for executing system commands
*   Graceful degradation: features are hidden or disabled on mobile platforms

