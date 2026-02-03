# Zettel Thinking Board 🧠

**A Visual AI Workbench for Obsidian.**

Zettel Thinking Board turns your Canvas into a stateful, executable flow diagram. Chain together **Local LLMs** (Ollama) and **Python Scripts** to build complex AI workflows, visualize the results, and refine your thoughts.

## 🌟 The "Zettel" Workflow

Unlike other canvas tools where the output sits *between* nodes, Zettel Thinking Board keeps your logic clean.

*   **The Chain:** Connect your Prompt (Orange) directly to your Code (Blue).
*   **The Result:** When you run a node, a **Green Note** spawns below it (or updates if it already exists), connected by an edge labeled **`output`**. Re-running replaces the green note's content.
*   **The Flow:** Data passes invisibly from parent to child. The Green Note is just for you to read; the Code node reads the raw data directly from the Prompt node. The `output` edge is reserved—Run Node and Run Chain ignore it (green notes are not part of the execution graph).

## 🚀 Features

*   **Color-Coded Intelligence:**
    *   🟧 **Orange:** Primary LLM (e.g., Llama 3).
    *   🟪 **Purple:** Secondary LLM (e.g., Mistral - great for critiquing Orange).
    *   🟦 **Blue:** Python Code (Persistent State).
    *   🟩 **Green:** Auto-generated output (Visual Sidecar).
    *   🟨 **Yellow:** Comments / Static Context.
*   **Persistent Memory:** Variables defined in one Blue node are accessible in connected Blue nodes downstream.
*   **Edge variable injection:** Put a **variable name** on an edge (edit the edge label). In the target note, use `{{var:variableName}}` to inject that parent's output at that spot instead of concatenating it. Edges update after run to show "(injected)" or "(concatenated)". The label **`output`** is reserved for the run node → green output note and is not a variable name; Run Node / Run Chain ignore output edges.
*   **Side Channel Logging:** Send debug info to the side panel console without cluttering your canvas.
*   **Recursive Execution:** "Run Chain" automatically traces back to the start and runs the entire flow to ensure context is fresh.

## 🛠️ Requirements

1.  **Obsidian** (Latest version).
2.  **Ollama** running locally.
3.  **Python 3** installed in your system PATH.

## 📖 Quick Start

### 1. Setup
1.  Open the **Zettel Thinking Board** side panel (Right Ribbon).
2.  Select your models for Orange and Purple inputs.
3.  (Optional) Add Environment Variables (e.g., `MY_NAME` = `John`).

### 2. Create a Chain
1.  Add an **Orange Card**: "Write a haiku about rust programming."
2.  Add a **Blue Card** and draw an arrow from **Orange -> Blue**.
3.  In the Blue Card, write:
    ```python
    # 'input' is the string output from the Orange card
    lines = input.split('\n')
    print(f"Haiku has {len(lines)} lines") # Goes to Green Note

    # Send a log to the side panel
    obsidian_log("Analyzing structure...")
    ```

### 3. Run It
*   Right-click the **Blue Card** and select **Run Chain**.
*   **What happens?**
    1.  The Orange card runs. A Green note appears below it with the Haiku.
    2.  The Blue card receives the Haiku text instantly.
    3.  The Blue card runs. A Green note appears below it saying "Haiku has 3 lines".
    4.  "Analyzing structure..." appears in your Side Panel Console.

## 🔗 Edge variable injection

By default, all parent outputs are concatenated and passed to the child. You can instead **inject** a parent's output at a specific place in the child note.

1. **Name the edge:** Select the edge (line) from parent to child and set its **label** to a variable name (e.g. `summary`).
2. **Use the placeholder:** In the child note, write `{{var:summary}}` where you want the parent's output to appear.
3. **Run:** When you run the node or chain, `{{var:summary}}` is replaced by that parent's output, and that parent is **not** concatenated. Other parents (or the same parent if you don't use the variable) are still concatenated as before.
4. **Edge labels after run:** The edge label is updated to `summary (injected)` or `summary (concatenated)` so you can see how each edge was used.

Example: Orange → Purple with edge label `draft`. In the Purple note: "Critique this draft:\n\n{{var:draft}}\n\nBe concise." Only the draft is injected; no extra concatenation.

## ⚙️ Advanced: Python State
The Python kernel stays alive as long as Obsidian is open (or until you click "Restart Kernel").

**Node A (Blue):**
```python
memory = []
```

**Node B (Blue - Connected to A):**
```python
memory.append(input)
obsidian_log(f"Memory size: {len(memory)}")
```
This allows you to build complex data accumulation workflows.

## Development

*   **Install:** `npm install` (use `npm install --legacy-peer-deps` if needed for Vitest).
*   **Build:** `npm run build`
*   **Tests:** `npm run test` (unit tests with Vitest). `npm run test:watch` for watch mode.
*   **Deploy to a test vault:** Run `npm run deploy-to-vault` to build and copy `main.js`, `manifest.json`, and `styles.css` into the `zettel-thinking-board/` folder. Copy that folder into your vault at `.obsidian/plugins/zettel-thinking-board/`, then reload the plugin in Obsidian. Alternatively, use the provided `sendToNovelVault.sh` script (edit the path inside it to point at your vault) to build and copy in one step.

## ⚠️ Security Warning
This plugin allows the execution of **arbitrary Python code** on your machine via the Canvas.
*   **Never** run a canvas file you downloaded from an untrusted source.
*   The Python process runs with your user privileges.

## 📄 License
MIT
