#!/usr/bin/env python3
"""Synthetic whiteboard flowchart generator with COCO annotations & graph sidecars.

Generates varied flowchart images (marker thickness, shape sizes, stroke gaps,
crossing arrows, perspective camera angle, shadows, and blur) from known base
graphs, keeping all variants of the same graph_id in the same train/val/test split.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

CATEGORIES = [
    {"id": 1, "name": "rectangle", "supercategory": "shape"},
    {"id": 2, "name": "diamond", "supercategory": "shape"},
    {"id": 3, "name": "oval", "supercategory": "shape"},
    {"id": 4, "name": "arrowhead", "supercategory": "connector"},
]
CATEGORY_NAME_TO_ID = {c["name"]: c["id"] for c in CATEGORIES}

LABELS_POOL = [
    "Start",
    "End",
    "Check input",
    'Check "A & B"?',
    "Load data",
    "Valid?",
    "Retry",
    "Save & Exit",
    "Process",
    "Error!",
]
EDGE_LABELS = ["", "", "", "Yes", "No", "Valid", "Timeout", "A & B"]
MARKER_COLORS = [
    (24, 28, 36),     # black marker
    (20, 64, 158),    # blue marker
    (168, 32, 32),    # red marker
    (22, 110, 56),    # green marker
]


@dataclass
class BaseNode:
    id: str
    shape: str  # rectangle | diamond | oval
    label: str
    cx: float
    cy: float
    w: float
    h: float


@dataclass
class BaseEdge:
    id: str
    source: str
    target: str
    label: str


def build_base_graph(rng: random.Random, width: int, height: int) -> Tuple[List[BaseNode], List[BaseEdge]]:
    """Create a random flowchart topology, often with branches and crossing arrows."""
    num_nodes = rng.randint(4, 7)
    cols = rng.choice([2, 3])
    rows = math.ceil(num_nodes / cols)

    cell_w = width / (cols + 0.6)
    cell_h = height / (rows + 0.6)

    slots = [(c, r) for r in range(rows) for c in range(cols)]
    rng.shuffle(slots)
    chosen_slots = sorted(slots[:num_nodes], key=lambda s: (s[1], s[0]))

    nodes: List[BaseNode] = []
    for idx, (col, row) in enumerate(chosen_slots):
        if idx == 0:
            shape = "oval"
            label = "Start"
        elif idx == num_nodes - 1:
            shape = "oval"
            label = "End"
        else:
            shape = rng.choice(["rectangle", "diamond", "rectangle"])
            label = rng.choice(LABELS_POOL[2:])

        cx = (col + 0.8) * cell_w + rng.uniform(-0.12 * cell_w, 0.12 * cell_w)
        cy = (row + 0.8) * cell_h + rng.uniform(-0.10 * cell_h, 0.10 * cell_h)
        w = rng.uniform(0.45, 0.72) * cell_w
        h = rng.uniform(0.36, 0.58) * cell_h
        if shape == "diamond":
            w *= 1.15
            h *= 1.15

        nodes.append(
            BaseNode(
                id=f"n{idx + 1}",
                shape=shape,
                label=label,
                cx=max(w * 0.6 + 20, min(width - w * 0.6 - 20, cx)),
                cy=max(h * 0.6 + 20, min(height - h * 0.6 - 20, cy)),
                w=w,
                h=h,
            )
        )

    edges: List[BaseEdge] = []
    # Spine edges to guarantee connectivity
    for i in range(num_nodes - 1):
        edges.append(
            BaseEdge(
                id=f"e{i + 1}",
                source=nodes[i].id,
                target=nodes[i + 1].id,
                label=rng.choice(EDGE_LABELS),
            )
        )

    # Extra cross/skip edges to create crossing arrows and diamond branches
    extra_count = rng.randint(1, 3)
    for j in range(extra_count):
        src_idx = rng.randint(0, num_nodes - 2)
        tgt_idx = rng.randint(0, num_nodes - 1)
        if src_idx != tgt_idx and not any(
            e.source == nodes[src_idx].id and e.target == nodes[tgt_idx].id for e in edges
        ):
            edges.append(
                BaseEdge(
                    id=f"e_extra_{j + 1}",
                    source=nodes[src_idx].id,
                    target=nodes[tgt_idx].id,
                    label=rng.choice(EDGE_LABELS),
                )
            )

    return nodes, edges


def compute_perspective_coeffs(
    src_pts: Sequence[Tuple[float, float]],
    dst_pts: Sequence[Tuple[float, float]],
) -> Tuple[np.ndarray, np.ndarray]:
    """Solve 8-parameter homography matrix M (dst -> src for PIL, and src -> dst)."""
    matrix = []
    for (sx, sy), (dx, dy) in zip(src_pts, dst_pts):
        matrix.append([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy])
        matrix.append([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy])
    a = np.asarray(matrix, dtype=np.float64)
    b = np.asarray([c for pt in src_pts for c in pt], dtype=np.float64)
    coeffs = np.linalg.solve(a, b)

    m_dst_to_src = np.array(
        [
            [coeffs[0], coeffs[1], coeffs[2]],
            [coeffs[3], coeffs[4], coeffs[5]],
            [coeffs[6], coeffs[7], 1.0],
        ],
        dtype=np.float64,
    )
    m_src_to_dst = np.linalg.inv(m_dst_to_src)
    return coeffs, m_src_to_dst


def project_point(m: np.ndarray, x: float, y: float) -> Tuple[float, float]:
    vec = m @ np.array([x, y, 1.0], dtype=np.float64)
    if abs(vec[2]) < 1e-8:
        return x, y
    return float(vec[0] / vec[2]), float(vec[1] / vec[2])


def project_bbox(m: np.ndarray, x1: float, y1: float, x2: float, y2: float) -> Tuple[float, float, float, float]:
    corners = [
        project_point(m, x1, y1),
        project_point(m, x2, y1),
        project_point(m, x2, y2),
        project_point(m, x1, y2),
    ]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


def draw_dashed_line_with_gaps(
    draw: ImageDraw.ImageDraw,
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    color: Tuple[int, int, int],
    width: int,
    rng: random.Random,
    gap_prob: float,
) -> None:
    dist = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    steps = max(2, int(dist / 12))
    for i in range(steps):
        if rng.random() < gap_prob:
            continue
        t0 = i / steps
        t1 = (i + 1) / steps
        x0 = p1[0] + (p2[0] - p1[0]) * t0
        y0 = p1[1] + (p2[1] - p1[1]) * t0
        x1 = p1[0] + (p2[0] - p1[0]) * t1
        y1 = p1[1] + (p2[1] - p1[1]) * t1
        draw.line([(x0, y0), (x1, y1)], fill=color, width=width)


def boundary_point(node: BaseNode, target_x: float, target_y: float) -> Tuple[float, float]:
    dx = target_x - node.cx
    dy = target_y - node.cy
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return node.cx, node.cy
    rx = node.w / 2.0
    ry = node.h / 2.0
    if node.shape == "oval":
        scale = 1.0 / math.hypot(dx / rx, dy / ry)
        return node.cx + dx * scale, node.cy + dy * scale
    if node.shape == "diamond":
        scale = 1.0 / (abs(dx) / rx + abs(dy) / ry)
        return node.cx + dx * scale, node.cy + dy * scale
    # rectangle
    scale = min(rx / abs(dx) if abs(dx) > 1e-6 else 1e9, ry / abs(dy) if abs(dy) > 1e-6 else 1e9)
    return node.cx + dx * scale, node.cy + dy * scale


def render_variant(
    base_nodes: List[BaseNode],
    base_edges: List[BaseEdge],
    width: int,
    height: int,
    rng: random.Random,
) -> Tuple[Image.Image, List[dict], dict]:
    # Background whiteboard color with slight tint
    bg_val = rng.randint(235, 250)
    bg_color = (bg_val, bg_val + rng.randint(-4, 4), bg_val + rng.randint(-6, 4))
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    stroke_w = rng.randint(2, 6)
    gap_prob = rng.uniform(0.0, 0.14)
    color = rng.choice(MARKER_COLORS)
    font = ImageFont.load_default()

    # Jitter node sizes per variant
    nodes: List[BaseNode] = []
    for n in base_nodes:
        nodes.append(
            BaseNode(
                id=n.id,
                shape=n.shape,
                label=n.label,
                cx=n.cx + rng.uniform(-6, 6),
                cy=n.cy + rng.uniform(-6, 6),
                w=max(60.0, n.w * rng.uniform(0.88, 1.12)),
                h=max(40.0, n.h * rng.uniform(0.88, 1.12)),
            )
        )
    node_map: Dict[str, BaseNode] = {n.id: n for n in nodes}

    raw_annos: List[Tuple[str, float, float, float, float]] = []
    for n in nodes:
        x1, y1 = n.cx - n.w / 2.0, n.cy - n.h / 2.0
        x2, y2 = n.cx + n.w / 2.0, n.cy + n.h / 2.0

        if n.shape == "rectangle":
            pts = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
            for i in range(4):
                draw_dashed_line_with_gaps(draw, pts[i], pts[(i + 1) % 4], color, stroke_w, rng, gap_prob)
        elif n.shape == "diamond":
            pts = [(n.cx, y1), (x2, n.cy), (n.cx, y2), (x1, n.cy)]
            for i in range(4):
                draw_dashed_line_with_gaps(draw, pts[i], pts[(i + 1) % 4], color, stroke_w, rng, gap_prob)
        else:  # oval
            draw.ellipse([x1, y1, x2, y2], outline=color, width=stroke_w)
            if gap_prob > 0.05:
                # Simulate dry-erase marker skip with tiny background dot
                gx = n.cx + rng.uniform(-n.w * 0.25, n.w * 0.25)
                gy = y1 if rng.random() < 0.5 else y2
                draw.ellipse([gx - 3, gy - 3, gx + 3, gy + 3], fill=bg_color)

        draw.text((n.cx - len(n.label) * 3, n.cy - 6), n.label, fill=color, font=font)
        raw_annos.append((n.shape, x1, y1, x2, y2))

    raw_edges: List[dict] = []
    for e in base_edges:
        src = node_map[e.source]
        tgt = node_map[e.target]
        tail = boundary_point(src, tgt.cx, tgt.cy)
        head = boundary_point(tgt, src.cx, src.cy)

        # Optional slight curve midpoint for visual variety
        mid_x = (tail[0] + head[0]) / 2.0 + rng.uniform(-18, 18)
        mid_y = (tail[1] + head[1]) / 2.0 + rng.uniform(-18, 18)
        draw_dashed_line_with_gaps(draw, tail, (mid_x, mid_y), color, stroke_w, rng, gap_prob)
        draw_dashed_line_with_gaps(draw, (mid_x, mid_y), head, color, stroke_w, rng, gap_prob)

        if e.label:
            draw.text((mid_x + 4, mid_y - 8), e.label, fill=color, font=font)

        # Arrowhead at `head`
        angle = math.atan2(head[1] - mid_y, head[0] - mid_x)
        ah_len = rng.uniform(12.0, 20.0)
        ah_spread = rng.uniform(0.42, 0.58)
        wing1 = (head[0] - ah_len * math.cos(angle - ah_spread), head[1] - ah_len * math.sin(angle - ah_spread))
        wing2 = (head[0] - ah_len * math.cos(angle + ah_spread), head[1] - ah_len * math.sin(angle + ah_spread))
        draw.line([wing1, head, wing2], fill=color, width=stroke_w)

        ah_x1 = min(head[0], wing1[0], wing2[0]) - stroke_w
        ah_y1 = min(head[1], wing1[1], wing2[1]) - stroke_w
        ah_x2 = max(head[0], wing1[0], wing2[0]) + stroke_w
        ah_y2 = max(head[1], wing1[1], wing2[1]) + stroke_w
        raw_annos.append(("arrowhead", ah_x1, ah_y1, ah_x2, ah_y2))

        raw_edges.append(
            {
                "edge_id": e.id,
                "source": e.source,
                "target": e.target,
                "label": e.label or None,
                "tail": tail,
                "mid": (mid_x, mid_y),
                "head": head,
                "arrowhead_raw": (ah_x1, ah_y1, ah_x2, ah_y2),
            }
        )

    # Perspective camera angle warp
    max_shift = min(width, height) * 0.06
    src_quad = [(0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height))]
    dst_quad = [
        (rng.uniform(0, max_shift), rng.uniform(0, max_shift)),
        (width - rng.uniform(0, max_shift), rng.uniform(0, max_shift)),
        (width - rng.uniform(0, max_shift), height - rng.uniform(0, max_shift)),
        (rng.uniform(0, max_shift), height - rng.uniform(0, max_shift)),
    ]
    coeffs, m_src_to_dst = compute_perspective_coeffs(src_quad, dst_quad)
    img = img.transform((width, height), Image.Transform.PERSPECTIVE, coeffs.tolist(), Image.Resampling.BILINEAR)

    # Shadows / uneven lighting gradient
    if rng.random() < 0.75:
        arr = np.asarray(img, dtype=np.float32)
        yy, xx = np.mgrid[0:height, 0:width]
        angle_s = rng.uniform(0, math.pi * 2)
        grad = (xx / width - 0.5) * math.cos(angle_s) + (yy / height - 0.5) * math.sin(angle_s)
        shade = 1.0 - rng.uniform(0.08, 0.25) * (grad + 0.5)
        arr = np.clip(arr * shade[:, :, None], 0, 255).astype(np.uint8)
        img = Image.fromarray(arr)

    # Blur
    if rng.random() < 0.55:
        img = img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.4, 1.3)))

    # Project all annotations into warped image coordinates
    coco_boxes: List[dict] = []
    for cat_name, x1, y1, x2, y2 in raw_annos:
        px1, py1, px2, py2 = project_bbox(m_src_to_dst, x1, y1, x2, y2)
        px1 = max(0.0, min(float(width - 1), px1))
        py1 = max(0.0, min(float(height - 1), py1))
        px2 = max(px1 + 1.0, min(float(width), px2))
        py2 = max(py1 + 1.0, min(float(height), py2))
        bw = px2 - px1
        bh = py2 - py1
        coco_boxes.append(
            {
                "category_id": CATEGORY_NAME_TO_ID[cat_name],
                "category_name": cat_name,
                "bbox": [round(px1, 2), round(py1, 2), round(bw, 2), round(bh, 2)],
                "area": round(bw * bh, 2),
                "iscrowd": 0,
            }
        )

    # Project graph nodes and arrow endpoints for connection-logic testing
    graph_nodes = []
    for n in nodes:
        px1, py1, px2, py2 = project_bbox(
            m_src_to_dst,
            n.cx - n.w / 2.0,
            n.cy - n.h / 2.0,
            n.cx + n.w / 2.0,
            n.cy + n.h / 2.0,
        )
        graph_nodes.append(
            {
                "id": n.id,
                "shape": n.shape,
                "label": n.label,
                "position": {"x": round(px1, 2), "y": round(py1, 2)},
                "width": round(px2 - px1, 2),
                "height": round(py2 - py1, 2),
            }
        )

    graph_edges = []
    arrow_endpoints = []
    for re_edge in raw_edges:
        tx, ty = project_point(m_src_to_dst, *re_edge["tail"])
        mx, my = project_point(m_src_to_dst, *re_edge["mid"])
        hx, hy = project_point(m_src_to_dst, *re_edge["head"])
        ax1, ay1, ax2, ay2 = project_bbox(m_src_to_dst, *re_edge["arrowhead_raw"])

        edge_entry = {
            "id": re_edge["edge_id"],
            "source": re_edge["source"],
            "target": re_edge["target"],
            "bendPoints": [{"x": round(mx, 2), "y": round(my, 2)}],
        }
        if re_edge["label"]:
            edge_entry["label"] = re_edge["label"]
        graph_edges.append(edge_entry)

        arrow_endpoints.append(
            {
                "edge_id": re_edge["edge_id"],
                "source": re_edge["source"],
                "target": re_edge["target"],
                "tail": {"x": round(tx, 2), "y": round(ty, 2)},
                "head": {"x": round(hx, 2), "y": round(hy, 2)},
                "arrowhead_bbox": [round(ax1, 2), round(ay1, 2), round(ax2 - ax1, 2), round(ay2 - ay1, 2)],
            }
        )

    sidecar = {
        "version": 1,
        "nodes": graph_nodes,
        "edges": graph_edges,
        "unresolvedArrows": [],
        "arrow_endpoints": arrow_endpoints,
    }
    return img, coco_boxes, sidecar


def generate_dataset(
    output_dir: Path,
    num_graphs: int,
    variants_per_graph: int,
    width: int,
    height: int,
    seed: int,
    train_ratio: float,
    val_ratio: float,
) -> None:
    rng = random.Random(seed)

    graph_indices = list(range(num_graphs))
    rng.shuffle(graph_indices)
    n_train = max(1, int(round(num_graphs * train_ratio)))
    n_val = max(1, int(round(num_graphs * val_ratio))) if num_graphs >= 3 else 0

    split_by_graph: Dict[int, str] = {}
    for idx, g_idx in enumerate(graph_indices):
        if idx < n_train:
            split_by_graph[g_idx] = "train"
        elif idx < n_train + n_val:
            split_by_graph[g_idx] = "val"
        else:
            split_by_graph[g_idx] = "test"

    coco_splits: Dict[str, dict] = {
        split: {"images": [], "annotations": [], "categories": CATEGORIES}
        for split in ("train", "val", "test")
    }
    next_img_id = 1
    next_ann_id = 1

    for g_idx in range(num_graphs):
        split = split_by_graph[g_idx]
        graph_id = f"g{g_idx:05d}"
        base_nodes, base_edges = build_base_graph(rng, width, height)

        img_dir = output_dir / "images" / split
        graph_dir = output_dir / "graphs" / split
        img_dir.mkdir(parents=True, exist_ok=True)
        graph_dir.mkdir(parents=True, exist_ok=True)

        for v_idx in range(variants_per_graph):
            sample_id = f"{graph_id}_v{v_idx:02d}"
            img, boxes, sidecar = render_variant(base_nodes, base_edges, width, height, rng)

            img_rel = f"{split}/{sample_id}.jpg"
            img_path = output_dir / "images" / img_rel
            img.save(img_path, quality=rng.randint(82, 95))

            sidecar["graph_id"] = graph_id
            sidecar["split"] = split
            sidecar["image"] = img_rel
            with open(graph_dir / f"{sample_id}.json", "w", encoding="utf-8") as f:
                json.dump(sidecar, f, indent=2)

            coco_splits[split]["images"].append(
                {
                    "id": next_img_id,
                    "file_name": img_rel,
                    "width": width,
                    "height": height,
                    "graph_id": graph_id,
                }
            )
            for box in boxes:
                coco_splits[split]["annotations"].append(
                    {
                        "id": next_ann_id,
                        "image_id": next_img_id,
                        "category_id": box["category_id"],
                        "bbox": box["bbox"],
                        "area": box["area"],
                        "iscrowd": 0,
                    }
                )
                next_ann_id += 1
            next_img_id += 1

    ann_dir = output_dir / "annotations"
    ann_dir.mkdir(parents=True, exist_ok=True)
    for split, payload in coco_splits.items():
        with open(ann_dir / f"instances_{split}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic whiteboard flowchart dataset.")
    parser.add_argument("--output-dir", type=Path, default=Path("dataset"))
    parser.add_argument("--num-graphs", type=int, default=500, help="Number of distinct base graphs.")
    parser.add_argument("--variants-per-graph", type=int, default=6, help="Augmented variants per base graph.")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=640)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    args = parser.parse_args()

    generate_dataset(
        output_dir=args.output_dir,
        num_graphs=args.num_graphs,
        variants_per_graph=args.variants_per_graph,
        width=args.width,
        height=args.height,
        seed=args.seed,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
    )
    total = args.num_graphs * args.variants_per_graph
    print(f"Generated {total} images ({args.num_graphs} graphs x {args.variants_per_graph} variants) in {args.output_dir}")


if __name__ == "__main__":
    main()
