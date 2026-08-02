#!/usr/bin/env python3
# Copyright (c) 2026 Inspatio. All rights reserved.
#
# This software and its associated documentation are proprietary to Inspatio.
# Unauthorized copying, modification, distribution, or use is prohibited
# without prior written permission from Inspatio.

"""Create the static scene manifest consumed by the project-page Gallery."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from plyfile import PlyData

PROJECT_ROOT = Path(__file__).resolve().parent
GS_ROOT = PROJECT_ROOT / "static" / "gs"
MANIFEST = GS_ROOT / "scenes.json"
REQUIRED = {
    "input_images",
    "gaussians_no_tto.ply",
    "gaussians_tto50.ply",
    "cameras.json",
    "render.gif",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def gaussian_centroid(path: Path) -> list[float]:
    vertices = PlyData.read(path)["vertex"].data
    return [
        float(np.mean(vertices[axis], dtype=np.float64))
        for axis in ("x", "y", "z")
    ]


def main() -> None:
    scenes = []
    for directory in sorted(GS_ROOT.iterdir()):
        if not directory.is_dir() or directory.name.startswith("."):
            continue
        if {path.name for path in directory.iterdir()} != REQUIRED:
            continue
        images = sorted(
            path.name for path in (directory / "input_images").iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
        )
        if not images:
            continue
        prefix = f"static/gs/{directory.name}"
        scenes.append({
            "id": directory.name,
            "label": f"Scene {directory.name}",
            "gif": f"{prefix}/render.gif",
            "inputs": [f"{prefix}/input_images/{name}" for name in images],
            "cameras": f"{prefix}/cameras.json",
            "noTto": f"{prefix}/gaussians_no_tto.ply",
            "tto": f"{prefix}/gaussians_tto50.ply",
            "centroid": gaussian_centroid(directory / "gaussians_tto50.ply"),
        })
    MANIFEST.write_text(json.dumps({"scenes": scenes}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {MANIFEST.relative_to(PROJECT_ROOT)} with {len(scenes)} scene(s).")


if __name__ == "__main__":
    main()
