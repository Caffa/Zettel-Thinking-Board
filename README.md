# Zettel Thinking Board 🧠

**A Visual AI Workbench for Obsidian.**

Zettel Thinking Board turns your Canvas into a stateful, executable flow diagram. Chain together **Local LLMs** (Ollama) and **Python Scripts** to build complex AI workflows, visualize the results, and refine your thoughts.

## 🌟 The "Zettel" Workflow

Unlike other canvas tools where the output sits *between* nodes, Zettel Thinking Board keeps your logic clean.

*   **The Chain:** Connect your Prompt (Orange) directly to your Code (Blue).
*   **The Result:** When you run a node, a **Green Note** spawns below it displaying the result.
*   **The Flow:** Data passes invisibly from parent to child. The Green Note is just for you to read; the Code node reads the raw data directly from the Prompt node.

## 🚀 Features

*   **Color-Coded Intelligence:**
    *   🟧 **Orange:** Primary LLM (e.g., Llama 3).
    *   🟪 **Purple:** Secondary LLM (e.g., Mistral - great for critiquing Orange).
    *   🟦 **Blue:** Python Code (Persistent State).
    *   🟩 **Green:** Auto-generated output (Visual Sidecar).
    *   🟨 **Yellow:** Comments / Static Context.
*   **Persistent Memory:** Variables defined in one Blue node are accessible in connected Blue nodes downstream.
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

## ⚠️ Security Warning
This plugin allows the execution of **arbitrary Python code** on your machine via the Canvas.
*   **Never** run a canvas file you downloaded from an untrusted source.
*   The Python process runs with your user privileges.

## 📄 License
MIT
