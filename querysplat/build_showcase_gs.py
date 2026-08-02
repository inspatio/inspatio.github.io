#!/usr/bin/env python3
# Copyright (c) 2026 Inspatio. All rights reserved.
#
# This software and its associated documentation are proprietary to Inspatio.
# Unauthorized copying, modification, distribution, or use is prohibited
# without prior written permission from Inspatio.

"""Build compact QuerySplat assets for every directory in show_cases.

Each completed scene contains exactly:
  input_images/, gaussians_tto50.ply, gaussians_no_tto.ply,
  cameras.json, and render.gif.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import traceback


SCRIPT = Path(__file__).resolve()
PROJECT_PAGE = SCRIPT.parent
DEFAULT_REPO = Path("/mnt/cfs/liyinglong/QuerySplat")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
FINAL_ENTRIES = {
    "input_images",
    "gaussians_tto50.ply",
    "gaussians_no_tto.ply",
    "cameras.json",
    "render.gif",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run QuerySplat on all showcase scenes and build website assets."
    )
    parser.add_argument("--show-cases", type=Path, default=PROJECT_PAGE / "show_cases")
    parser.add_argument("--output-root", type=Path, default=PROJECT_PAGE / "static/gs")
    parser.add_argument(
        "--scenes",
        nargs="*",
        default=None,
        help="Optional scene directory names to process, e.g. --scenes 01 06.",
    )
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO)
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_REPO / "workspace/finetune_dl3dv_vggt_omega_8_4_8192/config.yaml",
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=DEFAULT_REPO / "workspace/finetune_dl3dv_vggt_omega_8_4_8192/ema_model.safetensors",
    )
    parser.add_argument(
        "--gpus",
        default=None,
        help="Comma-separated visible GPU ids, e.g. 0,1,3. Default: all visible GPUs.",
    )
    parser.add_argument("--workers", type=int, default=None, help="Maximum parallel GPUs.")
    parser.add_argument("--resolution", type=int, default=128)
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--duration", type=float, default=2.0)
    parser.add_argument(
        "--opacity-threshold",
        type=float,
        default=0.02,
        help="Minimum opacity for exported Gaussians (default: 0.02).",
    )
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip a scene whenever its destination directory already exists, even if incomplete.",
    )
    parser.add_argument("--keep-work", action="store_true", help="Keep failed temporary outputs.")
    parser.add_argument("--dry-run", action="store_true")

    # Private mode is launched in a fresh process so each renderer sees one GPU.
    parser.add_argument("--_render", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--_ply", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--_cameras", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--_gif", type=Path, help=argparse.SUPPRESS)
    return parser.parse_args()


def visible_gpus(requested: str | None) -> list[str]:
    if requested:
        result = [item.strip() for item in requested.split(",") if item.strip()]
    elif os.environ.get("CUDA_VISIBLE_DEVICES"):
        result = [item.strip() for item in os.environ["CUDA_VISIBLE_DEVICES"].split(",")]
    else:
        query = subprocess.run(
            ["nvidia-smi", "--query-gpu=index", "--format=csv,noheader"],
            check=True,
            text=True,
            capture_output=True,
        )
        result = [line.strip() for line in query.stdout.splitlines() if line.strip()]
    if not result:
        raise RuntimeError("No GPU found. Use --gpus to specify CUDA devices.")
    return result


def scene_images(scene: Path) -> list[Path]:
    return sorted(
        path for path in scene.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def is_complete(path: Path) -> bool:
    return path.is_dir() and {entry.name for entry in path.iterdir()} == FINAL_ENTRIES


def run_checked(command: list[str], *, cwd: Path, env: dict[str, str], log: Path) -> None:
    with log.open("a", encoding="utf-8") as stream:
        stream.write("COMMAND: " + " ".join(command) + "\n")
        stream.flush()
        subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True)


def build_scene(scene: Path, args: argparse.Namespace, gpu: str) -> str:
    images = scene_images(scene)
    if not images:
        return f"SKIP {scene.name}: no supported images"

    destination = args.output_root / scene.name
    if destination.is_dir() and args.skip_existing:
        return f"SKIP {scene.name}: destination directory exists"
    if is_complete(destination) and not args.overwrite:
        return f"SKIP {scene.name}: already complete"
    if destination.exists() and not args.overwrite:
        raise FileExistsError(f"Incomplete output exists at {destination}; use --overwrite")
    if args.dry_run:
        return f"DRY  {scene.name}: {len(images)} image(s) on GPU {gpu}"

    args.output_root.mkdir(parents=True, exist_ok=True)
    work_root = args.output_root / ".work"
    work_root.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=f"{scene.name}-", dir=work_root))
    infer_dir = work / "infer"
    final_dir = work / "final"
    final_dir.mkdir()
    log = work / "build.log"
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = gpu
    env["PYTHONUNBUFFERED"] = "1"

    infer_command = [
        sys.executable,
        "-m",
        "scripts.infer",
        "--config",
        str(args.config),
        "--checkpoint",
        str(args.checkpoint),
        "--category",
        "custom",
        "--input_folder",
        str(scene),
        "--output_dir",
        str(infer_dir),
        "--gaussian_save_opacity_threshold",
        str(args.opacity_threshold),
        "--save_gaussian_alpha_distribution",
        "--save_gaussian_scale_distribution",
        "--save_vggt_depth_pointcloud",
        "--vggt_depth_pointcloud_target_points",
        "65536",
        "--save_predicted_input_cameras",
        "--use_tto",
        "--tto_n_steps",
        "50",
        "--tto_lr",
        "5e-3",
        "--tto_lpips_weight",
        "0.05",
        "--tto_save_step",
        "0",
        "50",
    ]

    succeeded = False
    try:
        run_checked(infer_command, cwd=args.repo, env=env, log=log)
        no_tto = infer_dir / "gaussians_tto_step0000.ply"
        tto50 = infer_dir / "gaussians_tto_step0050.ply"
        if not tto50.exists():
            tto50 = infer_dir / "gaussians.ply"
        required = [no_tto, tto50, infer_dir / "predicted_input_cameras.json", infer_dir / "input_frames"]
        missing = [str(path) for path in required if not path.exists()]
        if missing:
            raise RuntimeError("Inference did not create required outputs: " + ", ".join(missing))

        shutil.copytree(infer_dir / "input_frames", final_dir / "input_images")
        shutil.copy2(no_tto, final_dir / "gaussians_no_tto.ply")
        shutil.copy2(tto50, final_dir / "gaussians_tto50.ply")
        camera_data = json.loads((infer_dir / "predicted_input_cameras.json").read_text())
        for frame in camera_data.get("frames", []):
            frame["source"] = "input_images/" + Path(frame["source"]).name
        camera_data["trajectory"] = {
            "type": "piecewise cubic Bezier, ping-pong",
            "timing": "cosine ease-in/ease-out (slow-fast-slow)",
            "duration_seconds": args.duration,
            "fps": args.fps,
            "render_resolution": [args.resolution, args.resolution],
        }
        (final_dir / "cameras.json").write_text(
            json.dumps(camera_data, indent=2) + "\n", encoding="utf-8"
        )

        render_command = [
            sys.executable,
            str(SCRIPT),
            "--_render",
            "--_ply",
            str(final_dir / "gaussians_tto50.ply"),
            "--_cameras",
            str(final_dir / "cameras.json"),
            "--_gif",
            str(final_dir / "render.gif"),
            "--resolution",
            str(args.resolution),
            "--fps",
            str(args.fps),
            "--duration",
            str(args.duration),
        ]
        run_checked(render_command, cwd=args.repo, env=env, log=log)
        actual = {entry.name for entry in final_dir.iterdir()}
        if actual != FINAL_ENTRIES:
            raise RuntimeError(f"Unexpected final entries: {sorted(actual)}")

        if destination.exists():
            shutil.rmtree(destination)
        os.replace(final_dir, destination)
        succeeded = True
        return f"OK   {scene.name}: {len(images)} image(s) on GPU {gpu}"
    finally:
        if succeeded or not args.keep_work:
            shutil.rmtree(work, ignore_errors=True)


def quaternion_from_matrix(matrix):
    import numpy as np

    m = matrix[:3, :3]
    values, vectors = np.linalg.eigh(
        np.array(
            [
                [m[0, 0] - m[1, 1] - m[2, 2], m[1, 0] + m[0, 1], m[2, 0] + m[0, 2], m[2, 1] - m[1, 2]],
                [m[1, 0] + m[0, 1], m[1, 1] - m[0, 0] - m[2, 2], m[2, 1] + m[1, 2], m[0, 2] - m[2, 0]],
                [m[2, 0] + m[0, 2], m[2, 1] + m[1, 2], m[2, 2] - m[0, 0] - m[1, 1], m[1, 0] - m[0, 1]],
                [m[2, 1] - m[1, 2], m[0, 2] - m[2, 0], m[1, 0] - m[0, 1], m[0, 0] + m[1, 1] + m[2, 2]],
            ]
        ) / 3.0
    )
    q = vectors[:, values.argmax()][[3, 0, 1, 2]]  # w, x, y, z
    return q if q[0] >= 0 else -q


def matrix_from_quaternion(q):
    import numpy as np

    w, x, y, z = q / np.linalg.norm(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float32,
    )


def slerp(q0, q1, t: float):
    import numpy as np

    dot = float(np.dot(q0, q1))
    if dot < 0:
        q1, dot = -q1, -dot
    dot = min(1.0, max(-1.0, dot))
    if dot > 0.9995:
        result = q0 + t * (q1 - q0)
        return result / np.linalg.norm(result)
    theta = math.acos(dot)
    return (math.sin((1 - t) * theta) * q0 + math.sin(t * theta) * q1) / math.sin(theta)


def camera_track(camera_data: dict, frame_count: int):
    import numpy as np

    frames = camera_data.get("frames", [])
    if not frames:
        raise ValueError("Camera JSON contains no frames")
    c2ws = np.asarray([frame["c2w"] for frame in frames], dtype=np.float32)
    intrinsics = np.asarray([frame["intrinsics"] for frame in frames], dtype=np.float32)
    positions = c2ws[:, :3, 3]
    rotations = [quaternion_from_matrix(matrix) for matrix in c2ws]

    # A one-view scene has no baseline. Add a conservative local-right move whose
    # endpoint is revisited in reverse, preserving a seamless loop.
    if len(frames) == 1:
        right = c2ws[0, :3, 0]
        scene_depth = max(0.05, float(np.linalg.norm(positions[0])) * 0.03)
        positions = np.stack([positions[0], positions[0] + right * scene_depth])
        rotations = [rotations[0], rotations[0]]
        intrinsics = np.repeat(intrinsics, 2, axis=0)

    tangents = np.empty_like(positions)
    tangents[0] = positions[1] - positions[0]
    tangents[-1] = positions[-1] - positions[-2]
    if len(positions) > 2:
        tangents[1:-1] = 0.5 * (positions[2:] - positions[:-2])

    output_c2w, output_intrinsics = [], []
    for index in range(frame_count):
        # Periodic ping-pong: 0 -> 1 -> 0 in exactly two equal-duration halves.
        progress = 0.5 - 0.5 * math.cos(2 * math.pi * index / frame_count)
        scaled = progress * (len(positions) - 1)
        segment = min(int(scaled), len(positions) - 2)
        u = scaled - segment
        p0, p3 = positions[segment], positions[segment + 1]
        p1 = p0 + tangents[segment] / 3.0
        p2 = p3 - tangents[segment + 1] / 3.0
        position = (
            (1 - u) ** 3 * p0
            + 3 * (1 - u) ** 2 * u * p1
            + 3 * (1 - u) * u * u * p2
            + u**3 * p3
        )
        matrix = np.eye(4, dtype=np.float32)
        matrix[:3, :3] = matrix_from_quaternion(slerp(rotations[segment], rotations[segment + 1], u))
        matrix[:3, 3] = position
        output_c2w.append(matrix)
        output_intrinsics.append((1 - u) * intrinsics[segment] + u * intrinsics[segment + 1])
    return np.stack(output_c2w), np.stack(output_intrinsics)


def load_gaussians(path: Path, device):
    import numpy as np
    import torch
    from plyfile import PlyData

    vertex = PlyData.read(path)["vertex"].data
    names = set(vertex.dtype.names or ())
    required = {"x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"}
    if not required <= names:
        raise ValueError(f"Unsupported Gaussian PLY; missing {sorted(required - names)}")
    array = lambda keys: np.stack([vertex[key] for key in keys], axis=-1).astype(np.float32)
    means = torch.from_numpy(array(["x", "y", "z"])).to(device)
    opacity = torch.sigmoid(torch.from_numpy(array(["opacity"])[:, 0])).to(device)
    scales = torch.exp(torch.from_numpy(array(["scale_0", "scale_1", "scale_2"]))).to(device)
    quats = torch.from_numpy(array(["rot_0", "rot_1", "rot_2", "rot_3"])).to(device)
    quats = quats / quats.norm(dim=-1, keepdim=True).clamp_min(1e-8)
    dc_names = sorted((name for name in names if name.startswith("f_dc_")), key=lambda x: int(x.rsplit("_", 1)[1]))
    rest_names = sorted((name for name in names if name.startswith("f_rest_")), key=lambda x: int(x.rsplit("_", 1)[1]))
    dc = array(dc_names).reshape(len(vertex), 1, 3)
    if rest_names:
        rest = array(rest_names).reshape(len(vertex), 3, -1).transpose(0, 2, 1)
        sh = np.concatenate([dc, rest], axis=1)
    else:
        sh = dc
    degree = int(round(math.sqrt(sh.shape[1]) - 1))
    return means, quats, scales, opacity, torch.from_numpy(sh.copy()).to(device), degree


def render_gif(args: argparse.Namespace) -> None:
    import numpy as np
    import torch
    from gsplat.rendering import rasterization
    from PIL import Image

    if args.resolution <= 0 or args.fps <= 0 or args.duration <= 0:
        raise ValueError("--resolution, --fps, and --duration must be positive")
    frame_count = max(2, int(round(args.fps * args.duration)))
    camera_data = json.loads(args._cameras.read_text())
    c2ws, intrinsics = camera_track(camera_data, frame_count)
    device = torch.device("cuda")
    means, quats, scales, opacities, colors, sh_degree = load_gaussians(args._ply, device)
    w2cs = torch.from_numpy(np.linalg.inv(c2ws).astype(np.float32)).to(device)

    # Saved intrinsics use the preprocessed input pixel convention. Infer that
    # canvas from its centered principal point, then scale it to the GIF size.
    source_w = np.maximum(1.0, 2.0 * intrinsics[:, 2])
    source_h = np.maximum(1.0, 2.0 * intrinsics[:, 3])
    scaled = intrinsics.copy()
    scaled[:, [0, 2]] *= args.resolution / source_w[:, None]
    scaled[:, [1, 3]] *= args.resolution / source_h[:, None]
    ks = np.zeros((frame_count, 3, 3), dtype=np.float32)
    ks[:, 0, 0], ks[:, 1, 1] = scaled[:, 0], scaled[:, 1]
    ks[:, 0, 2], ks[:, 1, 2], ks[:, 2, 2] = scaled[:, 2], scaled[:, 3], 1
    ks_t = torch.from_numpy(ks).to(device)

    rendered = []
    with torch.inference_mode():
        for start in range(0, frame_count, 10):
            end = min(start + 10, frame_count)
            rgb, _, _ = rasterization(
                means=means,
                quats=quats,
                scales=scales,
                opacities=opacities,
                colors=colors,
                viewmats=w2cs[start:end],
                Ks=ks_t[start:end],
                width=args.resolution,
                height=args.resolution,
                near_plane=0.01,
                far_plane=100.0,
                backgrounds=torch.ones((end - start, 3), device=device),
                render_mode="RGB",
                sh_degree=sh_degree,
                packed=False,
            )
            rendered.extend((rgb.clamp(0, 1).mul(255).byte().cpu().numpy()))
    frames = [Image.fromarray(frame, mode="RGB") for frame in rendered]
    frames[0].save(
        args._gif,
        save_all=True,
        append_images=frames[1:],
        duration=max(1, round(1000 / args.fps)),
        loop=0,
        disposal=2,
        optimize=False,
    )


def process_scene(gpu: str, scene: Path, args: argparse.Namespace) -> tuple[str, float]:
    started = time.monotonic()
    try:
        message = build_scene(scene, args, gpu)
    except Exception as error:
        message = f"FAIL {scene.name} on GPU {gpu}: {error}\n{traceback.format_exc()}"
    return message, time.monotonic() - started


def main() -> int:
    args = parse_args()
    if args._render:
        render_gif(args)
        return 0
    if args.overwrite and args.skip_existing:
        raise ValueError("--overwrite and --skip-existing cannot be used together")
    if not 0.0 <= args.opacity_threshold <= 1.0:
        raise ValueError("--opacity-threshold must be between 0 and 1")
    for path, label in ((args.repo, "repo"), (args.config, "config"), (args.checkpoint, "checkpoint"), (args.show_cases, "show_cases")):
        if not path.exists():
            raise FileNotFoundError(f"{label} does not exist: {path}")
    scenes = sorted(path for path in args.show_cases.iterdir() if path.is_dir() and not path.name.startswith("."))
    if args.scenes:
        requested = set(args.scenes)
        available = {path.name for path in scenes}
        missing = sorted(requested - available)
        if missing:
            raise ValueError("Unknown scene(s): " + ", ".join(missing))
        scenes = [path for path in scenes if path.name in requested]
    if not scenes:
        raise RuntimeError(f"No scene directories found in {args.show_cases}")
    gpus = visible_gpus(args.gpus)
    if args.workers is not None:
        if args.workers <= 0:
            raise ValueError("--workers must be positive")
        gpus = gpus[: args.workers]
    gpus = gpus[: len(scenes)]
    print(f"Processing {len(scenes)} scene(s) with {len(gpus)} GPU worker(s): {', '.join(gpus)}")
    failures = []
    completed = 0
    pending_scenes = iter(scenes)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(gpus)) as executor:
        active: dict[concurrent.futures.Future, tuple[str, Path]] = {}
        for gpu in gpus:
            scene = next(pending_scenes, None)
            if scene is not None:
                active[executor.submit(process_scene, gpu, scene, args)] = (gpu, scene)

        while active:
            done, _ = concurrent.futures.wait(
                active, return_when=concurrent.futures.FIRST_COMPLETED
            )
            for future in done:
                gpu, scene = active.pop(future)
                message, elapsed = future.result()
                completed += 1
                image_count = len(scene_images(scene))
                progress = 100.0 * completed / len(scenes)
                print(
                    f"[{completed}/{len(scenes)} {progress:5.1f}%] "
                    f"{scene.name}: {image_count} image(s), GPU {gpu}, "
                    f"{elapsed:.1f}s | {message}",
                    flush=True,
                )
                if message.startswith("FAIL"):
                    failures.append(message)

                next_scene = next(pending_scenes, None)
                if next_scene is not None:
                    active[executor.submit(process_scene, gpu, next_scene, args)] = (
                        gpu,
                        next_scene,
                    )
    work_root = args.output_root / ".work"
    if work_root.exists() and not any(work_root.iterdir()):
        work_root.rmdir()
    print(f"Finished: {len(scenes) - len(failures)} succeeded/skipped, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
