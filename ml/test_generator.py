import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_synthetic_flowcharts import CATEGORIES, generate_dataset
from split_and_merge_real import merge_real_with_writer_holdout


class TestSyntheticDatasetGenerator(unittest.TestCase):
    def test_generate_coco_and_sidecars_with_graph_grouped_splits(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "dataset"
            generate_dataset(
                output_dir=out_dir,
                num_graphs=10,
                variants_per_graph=3,
                width=640,
                height=640,
                seed=123,
                train_ratio=0.6,
                val_ratio=0.2,
            )

            seen_graph_ids = {}
            seen_categories = set()
            total_images = 0

            for split in ("train", "val", "test"):
                ann_path = out_dir / "annotations" / f"instances_{split}.json"
                self.assertTrue(ann_path.exists())
                with open(ann_path, "r", encoding="utf-8") as f:
                    coco = json.load(f)

                self.assertEqual([c["name"] for c in coco["categories"]], [c["name"] for c in CATEGORIES])
                for img in coco["images"]:
                    total_images += 1
                    gid = img["graph_id"]
                    if gid in seen_graph_ids:
                        self.assertEqual(seen_graph_ids[gid], split, f"Graph {gid} leaked across splits!")
                    seen_graph_ids[gid] = split

                    img_file = out_dir / "images" / img["file_name"]
                    self.assertTrue(img_file.exists())

                    sidecar_file = out_dir / "graphs" / Path(img["file_name"]).with_suffix(".json")
                    self.assertTrue(sidecar_file.exists())
                    with open(sidecar_file, "r", encoding="utf-8") as sf:
                        sidecar = json.load(sf)
                    self.assertEqual(sidecar["version"], 1)
                    self.assertGreaterEqual(len(sidecar["nodes"]), 4)
                    self.assertGreaterEqual(len(sidecar["arrow_endpoints"]), 3)
                    for ep in sidecar["arrow_endpoints"]:
                        self.assertIn("tail", ep)
                        self.assertIn("head", ep)
                        self.assertEqual(len(ep["arrowhead_bbox"]), 4)

                for ann in coco["annotations"]:
                    seen_categories.add(ann["category_id"])
                    x, y, w, h = ann["bbox"]
                    self.assertGreaterEqual(x, 0.0)
                    self.assertGreaterEqual(y, 0.0)
                    self.assertGreater(w, 0.0)
                    self.assertGreater(h, 0.0)
                    self.assertLessEqual(x + w, 640.0 + 1e-6)
                    self.assertLessEqual(y + h, 640.0 + 1e-6)

            self.assertEqual(total_images, 30)
            self.assertEqual(seen_categories, {1, 2, 3, 4})

    def test_writer_holdout_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ds_dir = root / "dataset"
            generate_dataset(
                output_dir=ds_dir,
                num_graphs=5,
                variants_per_graph=2,
                width=320,
                height=320,
                seed=7,
                train_ratio=0.6,
                val_ratio=0.2,
            )

            real_dir = root / "real_images"
            for writer in ("alice", "bob", "carol"):
                (real_dir / writer).mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (320, 320), (240, 240, 240)).save(real_dir / writer / "diagram.jpg")

            real_coco = {
                "categories": CATEGORIES,
                "images": [
                    {"id": 1, "file_name": "alice/diagram.jpg", "width": 320, "height": 320},
                    {"id": 2, "file_name": "bob/diagram.jpg", "width": 320, "height": 320},
                    {"id": 3, "file_name": "carol/diagram.jpg", "width": 320, "height": 320},
                ],
                "annotations": [
                    {"id": 1, "image_id": 1, "category_id": 1, "bbox": [10, 10, 50, 30], "area": 1500, "iscrowd": 0},
                    {"id": 2, "image_id": 2, "category_id": 2, "bbox": [20, 20, 40, 40], "area": 1600, "iscrowd": 0},
                    {"id": 3, "image_id": 3, "category_id": 4, "bbox": [30, 30, 15, 15], "area": 225, "iscrowd": 0},
                ],
            }
            real_coco_path = root / "real.json"
            with open(real_coco_path, "w", encoding="utf-8") as f:
                json.dump(real_coco, f)

            counts = merge_real_with_writer_holdout(
                dataset_dir=ds_dir,
                real_coco_path=real_coco_path,
                real_images_dir=real_dir,
                val_writers={"bob"},
                test_writers={"carol"},
            )
            self.assertEqual(counts, {"train": 1, "val": 1, "test": 1})


if __name__ == "__main__":
    unittest.main()
