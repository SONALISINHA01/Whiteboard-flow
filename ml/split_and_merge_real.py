#!/usr/bin/env python3
"""Merge real photographed whiteboard diagrams with writer-level holdout splits.

Ensures entire writers (by `writer_id` field or top-level directory name in
`file_name`) are held out for val/test so the model is evaluated on unseen
handwriting and drawing styles.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Dict, List, Set


def extract_writer_id(image_entry: dict) -> str:
    if "writer_id" in image_entry and image_entry["writer_id"]:
        return str(image_entry["writer_id"])
    parts = Path(image_entry["file_name"]).parts
    if len(parts) >= 2:
        return parts[0]
    raise ValueError(f"Image entry {image_entry.get('file_name')} lacks writer_id or <writer_id>/ prefix.")


def merge_real_with_writer_holdout(
    dataset_dir: Path,
    real_coco_path: Path,
    real_images_dir: Path,
    val_writers: Set[str],
    test_writers: Set[str],
) -> Dict[str, int]:
    overlap = val_writers & test_writers
    if overlap:
        raise ValueError(f"Writers cannot appear in both val and test: {sorted(overlap)}")

    with open(real_coco_path, "r", encoding="utf-8") as f:
        real_coco = json.load(f)

    # Map real category names -> canonical IDs in dataset/annotations/
    real_cat_id_to_name = {c["id"]: c["name"] for c in real_coco["categories"]}

    anns_by_img: Dict[int, List[dict]] = {}
    for ann in real_coco["annotations"]:
        anns_by_img.setdefault(ann["image_id"], []).append(ann)

    split_data: Dict[str, dict] = {}
    max_img_id = 0
    max_ann_id = 0
    for split in ("train", "val", "test"):
        ann_file = dataset_dir / "annotations" / f"instances_{split}.json"
        with open(ann_file, "r", encoding="utf-8") as f:
            payload = json.load(f)
        split_data[split] = payload
        for im in payload["images"]:
            max_img_id = max(max_img_id, im["id"])
        for an in payload["annotations"]:
            max_ann_id = max(max_ann_id, an["id"])

    canonical_name_to_id = {
        c["name"]: c["id"] for c in split_data["train"]["categories"]
    }

    counts = {"train": 0, "val": 0, "test": 0}
    for img_entry in real_coco["images"]:
        writer = extract_writer_id(img_entry)
        if writer in test_writers:
            split = "test"
        elif writer in val_writers:
            split = "val"
        else:
            split = "train"

        src_path = real_images_dir / img_entry["file_name"]
        if not src_path.exists():
            raise FileNotFoundError(f"Missing real image: {src_path}")

        rel_dest = f"{split}/real_{writer}_{src_path.name}"
        dest_path = dataset_dir / "images" / rel_dest
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dest_path)

        max_img_id += 1
        new_img_id = max_img_id
        split_data[split]["images"].append(
            {
                "id": new_img_id,
                "file_name": rel_dest,
                "width": img_entry["width"],
                "height": img_entry["height"],
                "writer_id": writer,
                "is_real": True,
            }
        )

        for ann in anns_by_img.get(img_entry["id"], []):
            cat_name = real_cat_id_to_name[ann["category_id"]]
            if cat_name not in canonical_name_to_id:
                continue
            max_ann_id += 1
            split_data[split]["annotations"].append(
                {
                    "id": max_ann_id,
                    "image_id": new_img_id,
                    "category_id": canonical_name_to_id[cat_name],
                    "bbox": ann["bbox"],
                    "area": ann["area"],
                    "iscrowd": ann.get("iscrowd", 0),
                }
            )
        counts[split] += 1

    for split, payload in split_data.items():
        with open(dataset_dir / "annotations" / f"instances_{split}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge real diagrams with writer-level holdouts.")
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--real-coco", type=Path, required=True)
    parser.add_argument("--real-images-dir", type=Path, required=True)
    parser.add_argument("--val-writers", nargs="*", default=[])
    parser.add_argument("--test-writers", nargs="*", default=[])
    args = parser.parse_args()

    counts = merge_real_with_writer_holdout(
        dataset_dir=args.dataset_dir,
        real_coco_path=args.real_coco,
        real_images_dir=args.real_images_dir,
        val_writers=set(args.val_writers),
        test_writers=set(args.test_writers),
    )
    print(f"Merged real images with writer holdouts: {counts}")


if __name__ == "__main__":
    main()
