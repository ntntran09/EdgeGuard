"""Derive task-specific COCO datasets from a three-class Techna dataset.

The source train/valid/test assignment is always preserved, including whether
the source is group-aware or an intentionally leaky overfit split.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
from collections import Counter, defaultdict
from pathlib import Path


SPLITS = ("train", "valid", "test")


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, value: dict) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(value, file, indent=2, ensure_ascii=False)
        file.write("\n")


def load_manifest(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))
    if not rows:
        return {}
    if "final_split" in rows[0]:
        return {(row["final_split"], row["file_name"]): row for row in rows}
    if "new_split" in rows[0]:
        return {
            (row["new_split"], row["file_name"]): {
                "canonical_name": row["file_name"],
                "source_split": row.get("original_split", ""),
                "group_id": row.get("source_group", ""),
            }
            for row in rows
        }
    return {}


def copy_image(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"COCO image is missing: {source}")
    shutil.copy2(source, destination)


def base_coco(source_coco: dict, images: list[dict], annotations: list[dict], categories: list[dict]) -> dict:
    output = {
        key: value
        for key, value in source_coco.items()
        if key not in {"images", "annotations", "categories"}
    }
    output["images"] = images
    output["annotations"] = annotations
    output["categories"] = categories
    return output


def transformed_manifest_row(
    source_row: dict[str, str] | None,
    split: str,
    file_name: str,
    labels: list[str],
) -> dict[str, str | int]:
    return {
        "final_split": split,
        "file_name": file_name,
        "canonical_name": (source_row or {}).get("canonical_name", file_name),
        "source_split": (source_row or {}).get("source_split", split),
        "group_id": (source_row or {}).get("group_id", ""),
        "labels": ";".join(labels),
        "annotation_count": len(labels),
    }


def create_human_other(
    source_root: Path,
    output_root: Path,
    source_manifest: dict[tuple[str, str], dict[str, str]],
) -> dict:
    category_ids = {"human": 1, "other_object": 2}
    categories = [
        {"id": category_ids["human"], "name": "human", "supercategory": "none"},
        {"id": category_ids["other_object"], "name": "other_object", "supercategory": "none"},
    ]
    report: dict[str, dict] = {}
    manifest_rows: list[dict] = []

    for split in SPLITS:
        source_dir = source_root / split
        output_dir = output_root / split
        output_dir.mkdir(parents=True, exist_ok=False)
        source_coco = read_json(source_dir / "_annotations.coco.json")
        source_names = {int(cat["id"]): cat["name"] for cat in source_coco["categories"]}
        source_images = [
            image
            for image in source_coco["images"]
            if (source_dir / image["file_name"]).is_file()
        ]
        missing_images = [
            image["file_name"]
            for image in source_coco["images"]
            if not (source_dir / image["file_name"]).is_file()
        ]
        available_image_ids = {int(image["id"]) for image in source_images}
        annotations_by_image: dict[int, list[dict]] = defaultdict(list)
        output_annotations: list[dict] = []

        for annotation in source_coco["annotations"]:
            if int(annotation["image_id"]) not in available_image_ids:
                continue
            source_name = source_names[int(annotation["category_id"])]
            target_name = "human" if source_name == "human" else "other_object"
            converted = dict(annotation)
            converted["category_id"] = category_ids[target_name]
            output_annotations.append(converted)
            annotations_by_image[int(converted["image_id"])].append(converted)

        for image in source_images:
            file_name = image["file_name"]
            copy_image(source_dir / file_name, output_dir / file_name)
            labels = [
                categories[int(ann["category_id"]) - 1]["name"]
                for ann in annotations_by_image.get(int(image["id"]), [])
            ]
            manifest_rows.append(
                transformed_manifest_row(
                    source_manifest.get((split, file_name)), split, file_name, labels
                )
            )

        output_coco = base_coco(
            source_coco, source_images, output_annotations, categories
        )
        write_json(output_dir / "_annotations.coco.json", output_coco)
        counts = Counter(
            categories[int(annotation["category_id"]) - 1]["name"]
            for annotation in output_annotations
        )
        report[split] = {
            "images": len(source_images),
            "annotations": len(output_annotations),
            "background_images": sum(
                int(image["id"]) not in annotations_by_image for image in source_images
            ),
            "object_counts": dict(counts),
            "source_missing_images": missing_images,
        }

    write_manifest(output_root / "SPLIT_MANIFEST.csv", manifest_rows)
    return report


def create_package_backpack(
    source_root: Path,
    output_root: Path,
    source_manifest: dict[tuple[str, str], dict[str, str]],
) -> dict:
    category_ids = {"package": 1, "backpack": 2}
    categories = [
        {"id": category_ids["package"], "name": "package", "supercategory": "none"},
        {"id": category_ids["backpack"], "name": "backpack", "supercategory": "none"},
    ]
    report: dict[str, dict] = {}
    manifest_rows: list[dict] = []

    for split in SPLITS:
        source_dir = source_root / split
        output_dir = output_root / split
        output_dir.mkdir(parents=True, exist_ok=False)
        source_coco = read_json(source_dir / "_annotations.coco.json")
        source_names = {int(cat["id"]): cat["name"] for cat in source_coco["categories"]}
        source_images = [
            image
            for image in source_coco["images"]
            if (source_dir / image["file_name"]).is_file()
        ]
        missing_images = [
            image["file_name"]
            for image in source_coco["images"]
            if not (source_dir / image["file_name"]).is_file()
        ]
        available_image_ids = {int(image["id"]) for image in source_images}
        annotations_by_image: dict[int, list[dict]] = defaultdict(list)
        output_annotations: list[dict] = []

        for annotation in source_coco["annotations"]:
            if int(annotation["image_id"]) not in available_image_ids:
                continue
            source_name = source_names[int(annotation["category_id"])]
            if source_name not in category_ids:
                continue
            converted = dict(annotation)
            converted["category_id"] = category_ids[source_name]
            output_annotations.append(converted)
            annotations_by_image[int(converted["image_id"])].append(converted)

        output_images = [
            image
            for image in source_images
            if int(image["id"]) in annotations_by_image
        ]
        for image in output_images:
            file_name = image["file_name"]
            copy_image(source_dir / file_name, output_dir / file_name)
            labels = [
                categories[int(ann["category_id"]) - 1]["name"]
                for ann in annotations_by_image[int(image["id"])]
            ]
            manifest_rows.append(
                transformed_manifest_row(
                    source_manifest.get((split, file_name)), split, file_name, labels
                )
            )

        output_coco = base_coco(source_coco, output_images, output_annotations, categories)
        write_json(output_dir / "_annotations.coco.json", output_coco)
        counts = Counter(
            categories[int(annotation["category_id"]) - 1]["name"]
            for annotation in output_annotations
        )
        report[split] = {
            "images": len(output_images),
            "annotations": len(output_annotations),
            "background_images": 0,
            "object_counts": dict(counts),
            "source_missing_images": missing_images,
        }

    write_manifest(output_root / "SPLIT_MANIFEST.csv", manifest_rows)
    return report


def write_manifest(path: Path, rows: list[dict]) -> None:
    fieldnames = [
        "final_split",
        "file_name",
        "canonical_name",
        "source_split",
        "group_id",
        "labels",
        "annotation_count",
    ]
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_audit(
    output_root: Path,
    task: str,
    source_root: Path,
    split_report: dict,
    split_policy: str,
) -> None:
    total_images = sum(item["images"] for item in split_report.values())
    total_annotations = sum(item["annotations"] for item in split_report.values())
    audit = {
        "task": task,
        "source_dataset": str(source_root),
        "split_policy": split_policy,
        "split": split_report,
        "total_images": total_images,
        "total_annotations": total_annotations,
    }
    write_json(output_root / "SPLIT_AUDIT.json", audit)

    lines = [
        f"TECHNA DATASET 2 - {task.upper()}",
        "=" * 56,
        "",
        f"Source: {source_root}",
        f"Split policy: {split_policy}",
        "",
    ]
    if task == "human_other_object":
        lines.extend(
            [
                "Class mapping:",
                "- human -> human",
                "- package + backpack -> other_object",
                "- Original background images are retained.",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "Class selection:",
                "- package and backpack annotations are retained.",
                "- Human-only and original background images are excluded.",
                "- Human annotations in mixed images are removed.",
                "",
            ]
        )
    missing_by_split = {
        split: item.get("source_missing_images", [])
        for split, item in split_report.items()
        if item.get("source_missing_images")
    }
    if missing_by_split:
        lines.extend(
            [
                "Source integrity handling:",
                "- COCO records whose source image files were missing were excluded.",
            ]
        )
        for split, names in missing_by_split.items():
            for name in names:
                lines.append(f"- {split}: {name}")
        lines.append("")
    lines.append("Final split:")
    for split in SPLITS:
        item = split_report[split]
        counts = ", ".join(f"{key}={value}" for key, value in item["object_counts"].items())
        lines.append(
            f"- {split}: {item['images']} images, {item['annotations']} annotations, "
            f"{item['background_images']} background; objects: {counts}"
        )
    lines.extend(["", f"Total: {total_images} images, {total_annotations} annotations", ""])
    (output_root / "SPLIT_AUDIT.txt").write_text("\n".join(lines), encoding="utf-8")


def validate_dataset(root: Path, expected_categories: set[str]) -> None:
    for split in SPLITS:
        split_dir = root / split
        coco = read_json(split_dir / "_annotations.coco.json")
        category_ids = {int(cat["id"]) for cat in coco["categories"]}
        category_names = {cat["name"] for cat in coco["categories"]}
        image_ids = {int(image["id"]) for image in coco["images"]}
        if category_names != expected_categories:
            raise ValueError(f"Unexpected categories in {root.name}/{split}: {category_names}")
        if len(image_ids) != len(coco["images"]):
            raise ValueError(f"Duplicate image IDs in {root.name}/{split}")
        if len({int(ann["id"]) for ann in coco["annotations"]}) != len(coco["annotations"]):
            raise ValueError(f"Duplicate annotation IDs in {root.name}/{split}")
        for annotation in coco["annotations"]:
            if int(annotation["image_id"]) not in image_ids:
                raise ValueError(f"Orphan annotation in {root.name}/{split}")
            if int(annotation["category_id"]) not in category_ids:
                raise ValueError(f"Unknown category in {root.name}/{split}")
        disk_images = {
            path.name
            for path in split_dir.iterdir()
            if path.is_file() and path.name != "_annotations.coco.json"
        }
        json_images = {image["file_name"] for image in coco["images"]}
        if disk_images != json_images:
            raise ValueError(f"Image/JSON file mismatch in {root.name}/{split}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("human_other_output", type=Path)
    parser.add_argument("package_backpack_output", type=Path)
    args = parser.parse_args()

    for output in (args.human_other_output, args.package_backpack_output):
        if output.exists():
            raise FileExistsError(f"Refusing to overwrite existing output: {output}")
        output.mkdir(parents=True)

    source_manifest = load_manifest(args.source / "SPLIT_MANIFEST.csv")
    human_report = create_human_other(args.source, args.human_other_output, source_manifest)
    package_report = create_package_backpack(
        args.source, args.package_backpack_output, source_manifest
    )
    if (args.source / "OVERFIT_SPLIT_REPORT.txt").exists():
        split_policy = (
            "Preserved source overfit train/valid/test membership. Intentional "
            "cross-split leakage remains; metrics are not unbiased generalization estimates."
        )
    else:
        split_policy = (
            "Preserved source train/valid/test membership and group-aware leakage policy."
        )
    write_audit(
        args.human_other_output,
        "human_other_object",
        args.source,
        human_report,
        split_policy,
    )
    write_audit(
        args.package_backpack_output,
        "package_backpack",
        args.source,
        package_report,
        split_policy,
    )
    validate_dataset(args.human_other_output, {"human", "other_object"})
    validate_dataset(args.package_backpack_output, {"package", "backpack"})

    print(json.dumps({"human_other_object": human_report, "package_backpack": package_report}, indent=2))


if __name__ == "__main__":
    main()
