#!/usr/bin/env python3
"""Compare YOLOX-Tiny ONNX predictions in Python vs. the browser Web Worker.

Uses the exact same letterbox resize/padding (640x640, pad=114), BGR channel
order, auto-decode check, and class-aware NMS as src/vision/yolox.ts.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List, Tuple

import numpy as np
import onnxruntime as ort
from PIL import Image


def letterbox_bgr(img: Image.Image, target_size: int = 640) -> Tuple[np.ndarray, float, float, float]:
    src_w, src_h = img.size
    scale = min(target_size / src_w, target_size / src_h)
    new_w = max(1, round(src_w * scale))
    new_h = max(1, round(src_h * scale))
    pad_x = (target_size - src_w * scale) / 2.0
    pad_y = (target_size - src_h * scale) / 2.0

    resized = img.convert("RGB").resize((new_w, new_h), Image.Resampling.BILINEAR)
    padded = np.full((target_size, target_size, 3), 114.0, dtype=np.float32)
    arr = np.asarray(resized, dtype=np.float32)[:, :, ::-1]  # RGB -> BGR
    px = int(pad_x)
    py = int(pad_y)
    padded[py : py + new_h, px : px + new_w, :] = arr

    nchw = np.transpose(padded, (2, 0, 1))[None, :, :, :]
    return np.ascontiguousarray(nchw), scale, pad_x, pad_y


def is_already_decoded(output: np.ndarray) -> bool:
    sample = output[: min(512, len(output)), :2]
    return float(np.max(np.abs(sample))) > 25.0


def nms_class_aware(boxes: np.ndarray, scores: np.ndarray, cls_ids: np.ndarray, iou_thr: float) -> List[int]:
    order = np.argsort(-scores)
    keep: List[int] = []
    for idx in order:
        suppressed = False
        ax1, ay1, aw, ah = boxes[idx]
        ax2, ay2 = ax1 + aw, ay1 + ah
        for prev in keep:
            if cls_ids[prev] != cls_ids[idx]:
                continue
            bx1, by1, bw, bh = boxes[prev]
            bx2, by2 = bx1 + bw, by1 + bh
            ix1, iy1 = max(ax1, bx1), max(ay1, by1)
            ix2, iy2 = min(ax2, bx2), min(ay2, by2)
            inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
            union = aw * ah + bw * bh - inter
            if union > 0 and inter / union > iou_thr:
                suppressed = True
                break
        if not suppressed:
            keep.append(int(idx))
    return keep


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify ONNX YOLOX-Tiny parity with browser.")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--classes", type=Path, default=Path("ml/classes.json"))
    parser.add_argument("--score-thr", type=float, default=0.35)
    parser.add_argument("--nms-thr", type=float, default=0.45)
    args = parser.parse_args()

    with open(args.classes, "r", encoding="utf-8") as f:
        class_names = json.load(f)["classes"]

    img = Image.open(args.image)
    src_w, src_h = img.size
    tensor, scale, pad_x, pad_y = letterbox_bgr(img, 640)

    sess = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    raw_out = sess.run(None, {input_name: tensor})[0][0]

    decoded_in_model = is_already_decoded(raw_out)
    if not decoded_in_model:
        grids, strides = [], []
        for s in (8, 16, 32):
            g = 640 // s
            yv, xv = np.meshgrid(np.arange(g), np.arange(g), indexing="ij")
            grids.append(np.stack([xv, yv], axis=-1).reshape(-1, 2))
            strides.append(np.full((g * g, 1), s, dtype=np.float32))
        grid = np.concatenate(grids, axis=0)
        stride = np.concatenate(strides, axis=0)
        raw_out[:, :2] = (raw_out[:, :2] + grid) * stride
        raw_out[:, 2:4] = np.exp(raw_out[:, 2:4]) * stride

    obj = raw_out[:, 4]
    cls_scores = raw_out[:, 5 : 5 + len(class_names)]
    cls_ids = np.argmax(cls_scores, axis=1)
    scores = obj * cls_scores[np.arange(len(raw_out)), cls_ids]

    mask = scores >= args.score_thr
    filtered = raw_out[mask]
    f_scores = scores[mask]
    f_cls = cls_ids[mask]

    cx, cy, w, h = filtered[:, 0], filtered[:, 1], filtered[:, 2], filtered[:, 3]
    x1 = np.clip((cx - w / 2 - pad_x) / scale, 0, src_w)
    y1 = np.clip((cy - h / 2 - pad_y) / scale, 0, src_h)
    x2 = np.clip((cx + w / 2 - pad_x) / scale, 0, src_w)
    y2 = np.clip((cy + h / 2 - pad_y) / scale, 0, src_h)
    boxes = np.stack([x1, y1, np.maximum(0, x2 - x1), np.maximum(0, y2 - y1)], axis=1)

    keep = nms_class_aware(boxes, f_scores, f_cls, args.nms_thr)
    results = [
        {
            "class": class_names[int(f_cls[i])],
            "score": round(float(f_scores[i]), 4),
            "box": [round(float(v), 2) for v in boxes[i]],
        }
        for i in keep
    ]
    print(json.dumps({"decoded_in_model": decoded_in_model, "detections": results}, indent=2))


if __name__ == "__main__":
    main()
