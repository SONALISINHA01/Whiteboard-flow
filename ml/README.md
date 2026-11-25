# Whiteboard Flowchart Dataset & YOLOX-Tiny Training

## 1. Generate Synthetic Dataset (Graph-Grouped Splits)
Generates synthetic whiteboard flowchart images with varied marker thickness, shape sizes, stroke gaps, crossing arrows, perspective camera angles, shadows, and blur. All variants of the same `graph_id` stay in the same `train` / `val` / `test` split.

```bash
python ml/generate_synthetic_flowcharts.py \
  --output-dir ml/dataset \
  --num-graphs 500 \
  --variants-per-graph 6 \
  --seed 42
```

Each image has:
- `images/<split>/<sample_id>.jpg`
- `graphs/<split>/<sample_id>.json` (the original `FlowGraph` + `arrow_endpoints` for separate connection-logic testing)
- `annotations/instances_{train,val,test}.json` (COCO format for `rectangle`, `diamond`, `oval`, `arrowhead`)

## 2. Add Real Photographed Diagrams (Writer Holdout)
Organize real photos by writer folder (`real_images/<writer_id>/<photo>.jpg`) with a COCO JSON, then merge while holding out entire writers for `val` and `test`:

```bash
python ml/split_and_merge_real.py \
  --dataset-dir ml/dataset \
  --real-coco real_annotations.json \
  --real-images-dir real_images \
  --val-writers writer_04 \
  --test-writers writer_05 writer_06
```

## 3. Fine-Tune YOLOX-Tiny on Free Colab GPU & Export ONNX
1. Open [train_yolox_colab.ipynb](train_yolox_colab.ipynb) in Google Colab and select **Runtime -> Change runtime type -> T4 GPU**.
2. Upload `ml/generate_synthetic_flowcharts.py`, `ml/yolox_tiny_whiteboard.py`, and `ml/classes.json` to `/content/ml/` (or mount Google Drive).
3. Run all cells to fine-tune from `yolox_tiny.pth` and export `/content/export/yolox_tiny_whiteboard.onnx` alongside `classes.json`, `yolox_tiny_whiteboard.py`, and `best_ckpt.pth`.
4. Copy `yolox_tiny_whiteboard.onnx` and `classes.json` into `whiteboard-flow/public/models/` for on-device browser inference.
