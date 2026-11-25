#!/usr/bin/env python3
"""YOLOX-Tiny experiment configuration for whiteboard flowchart detection.

Class order (0-indexed for YOLOX, matching ml/classes.json):
  0: rectangle
  1: diamond
  2: oval
  3: arrowhead
"""

import os
from yolox.exp import Exp as MyExp


CLASSES = ("rectangle", "diamond", "oval", "arrowhead")


class Exp(MyExp):
    def __init__(self):
        super().__init__()
        # YOLOX-Tiny architecture multipliers
        self.depth = 0.33
        self.width = 0.375
        self.input_size = (640, 640)
        self.test_size = (640, 640)
        self.random_size = (10, 20)
        self.mosaic_scale = (0.5, 1.5)
        self.enable_mixup = False

        self.num_classes = len(CLASSES)
        self.data_dir = os.environ.get("WHITEBOARD_DATASET_DIR", "/content/dataset")
        self.train_ann = "instances_train.json"
        self.val_ann = "instances_val.json"
        self.test_ann = "instances_test.json"

        # Fine-tuning schedule
        self.max_epoch = 40
        self.warmup_epochs = 3
        self.no_aug_epochs = 5
        self.basic_lr_per_img = 0.01 / 64.0
        self.data_num_workers = 2
        self.eval_interval = 5
        self.exp_name = "yolox_tiny_whiteboard"

    def get_dataset(self, cache: bool = False, cache_type: str = "ram"):
        from yolox.data import COCODataset, TrainTransform

        return COCODataset(
            data_dir=self.data_dir,
            json_file=self.train_ann,
            name="images",
            img_size=self.input_size,
            preproc=TrainTransform(
                max_labels=100,
                flip_prob=self.flip_prob,
                hsv_prob=self.hsv_prob,
            ),
            cache=cache,
            cache_type=cache_type,
        )

    def get_eval_dataset(self, **kwargs):
        from yolox.data import COCODataset, ValTransform

        testdev = kwargs.get("testdev", False)
        legacy = kwargs.get("legacy", False)
        return COCODataset(
            data_dir=self.data_dir,
            json_file=self.val_ann if not testdev else self.test_ann,
            name="images",
            img_size=self.test_size,
            preproc=ValTransform(legacy=legacy),
        )
