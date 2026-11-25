# Whiteboard Flow

Turn whiteboard flowchart photos into editable diagrams right in your browser, then export to **draw.io** or **Mermaid**.

## Features

- **Browser-only inference**: Runs YOLOX-Tiny shape/arrowhead detection (ONNX Runtime Web, single-threaded WASM in a Web Worker) and PaddleOCR.js label recognition on-device.
- **Interactive diagram editor**: Built with React, TypeScript, Vite, and React Flow. Drag nodes, edit labels inline, swap shapes (`Process`, `Start / End`, `Decision`, `Input / Output`, `Database`, `Document`) while preserving connections, and undo/redo edits.
- **Uncertain arrow review**: Traces arrow strokes through crossings and small gaps, surfacing ambiguous connections with a cropped preview of the original photo so you can confirm the source and destination.
- **Shared versioned graph & exports**: Save/reopen projects as JSON (`version: 1`) and export cleanly to `.drawio` XML or Mermaid 11.3+ flowchart syntax.

## Getting Started

```bash
cd whiteboard-flow
npm install
npm run dev
```

Run tests and production build:

```bash
cd whiteboard-flow
npx vitest run
npm run build
```

## ML Pipeline (`ml/`)

- `ml/generate_synthetic_flowcharts.py` — generates synthetic whiteboard flowchart images with COCO annotations and graph sidecar JSONs.
- `ml/split_and_merge_real.py` — merges real photographed diagrams using writer-level holdouts.
- `ml/train_yolox_colab.ipynb` — fine-tunes YOLOX-Tiny and exports `yolox_tiny_whiteboard.onnx` + `classes.json`.
- `ml/verify_onnx_parity.py` — compares Python ONNX predictions against browser inference on the same image.
