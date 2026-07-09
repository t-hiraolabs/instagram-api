#!/usr/bin/env python3
"""素材シート（Sprite Sheet）から個々の素材を自動切り出しし、Supabase Storage/DBへ登録する。

管理画面（AdminAssetsScreen）からアップロードされた asset_sheets レコードを
--sheet-id で指定して実行する。開発者がローカルで実行する運用ツールで、
アプリ本体（Expo/Supabase Edge Functions）には含まれない。

使い方: python scripts/crop_sprite_sheet.py --sheet-id <asset_sheets.id>
"""
import argparse
import io
import os
import sys
import uuid
from datetime import datetime, timezone

import numpy as np
import requests
from dotenv import load_dotenv
from PIL import Image
from scipy import ndimage

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET = "story-assets"

ALPHA_THRESHOLD = 10        # この値より大きいアルファ値を「不透明」とみなす
MIN_COMPONENT_AREA = 50     # これより小さい連結成分はノイズとして除外（px^2）
CROP_PADDING = 4            # 切り出し時に残す余白（px）
THUMBNAIL_MAX_SIDE = 400


def rest_headers() -> dict:
    return {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def get_sheet(sheet_id: str) -> dict:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/asset_sheets",
        params={"id": f"eq.{sheet_id}", "select": "*"},
        headers=rest_headers(),
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise SystemExit(f"asset_sheets が見つかりません: {sheet_id}")
    return rows[0]


def get_category(category_id: str) -> dict:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/categories",
        params={"id": f"eq.{category_id}", "select": "slug,name"},
        headers=rest_headers(),
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise SystemExit(f"category が見つかりません: {category_id}")
    return rows[0]


def download_sheet(archive_storage_path: str) -> Image.Image:
    url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{archive_storage_path}"
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert("RGBA")


def upload_png(path: str, img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "image/png",
        "x-upsert": "false",
    }
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        headers=headers,
        data=buf.getvalue(),
        timeout=60,
    )
    r.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"


def detect_components(img: Image.Image) -> list[tuple[int, int, int, int]]:
    """アルファチャンネルの連結成分（＝輪郭）ごとにbounding boxを返す。"""
    alpha = np.array(img.split()[-1])
    mask = alpha > ALPHA_THRESHOLD
    labeled, count = ndimage.label(mask)
    boxes = []
    for i in range(1, count + 1):
        ys, xs = np.where(labeled == i)
        if len(xs) < MIN_COMPONENT_AREA:
            continue
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    return boxes


def mark_failed(sheet_id: str, message: str) -> None:
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/asset_sheets",
        params={"id": f"eq.{sheet_id}"},
        headers=rest_headers(),
        json={"status": "failed", "error_message": message},
        timeout=30,
    ).raise_for_status()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sheet-id", required=True, help="asset_sheets.id")
    parser.add_argument("--name-prefix", default=None, help="登録する素材名の接頭辞（省略時はカテゴリ名）")
    args = parser.parse_args()

    sheet = get_sheet(args.sheet_id)
    category = get_category(sheet["category_id"])
    slug = category["slug"]
    name_prefix = args.name_prefix or category["name"]

    print(f"[1/5] シート取得: {sheet['original_filename']} (category={category['name']})")
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/asset_sheets",
        params={"id": f"eq.{args.sheet_id}"},
        headers=rest_headers(),
        json={"status": "processing"},
        timeout=30,
    ).raise_for_status()

    try:
        sheet_img = download_sheet(sheet["archive_storage_path"])
        print(f"[2/5] 画像サイズ: {sheet_img.size}")

        boxes = detect_components(sheet_img)
        print(f"[3/5] 検出した素材数: {len(boxes)}")

        expected = None
        if sheet.get("grid_cols") and sheet.get("grid_rows"):
            expected = sheet["grid_cols"] * sheet["grid_rows"]
        if expected and len(boxes) != expected:
            msg = (
                f"検出数({len(boxes)})がgrid指定({expected})と一致しません。"
                "素材同士の重なりや余白不足の可能性があるため中断しました。"
            )
            mark_failed(args.sheet_id, msg)
            sys.exit(msg)
        if not boxes:
            msg = "透明でない領域が検出できませんでした。"
            mark_failed(args.sheet_id, msg)
            sys.exit(msg)

        w, h = sheet_img.size
        rows_to_insert = []
        for i, (x0, y0, x1, y1) in enumerate(boxes, start=1):
            px0 = max(0, x0 - CROP_PADDING)
            py0 = max(0, y0 - CROP_PADDING)
            px1 = min(w, x1 + CROP_PADDING + 1)
            py1 = min(h, y1 + CROP_PADDING + 1)
            crop = sheet_img.crop((px0, py0, px1, py1))

            thumb = crop.copy()
            thumb.thumbnail((THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE))

            asset_id = str(uuid.uuid4())
            storage_url = upload_png(f"{slug}/{asset_id}.png", crop)
            thumbnail_url = upload_png(f"{slug}/thumb_{asset_id}.png", thumb)

            rows_to_insert.append({
                "id": asset_id,
                "category_id": sheet["category_id"],
                "name": f"{name_prefix}_{i:03d}",
                "storage_url": storage_url,
                "thumbnail_url": thumbnail_url,
                "plan": "free",
                "width": crop.width,
                "height": crop.height,
                "sheet_id": args.sheet_id,
                "crop_x": px0, "crop_y": py0, "crop_w": px1 - px0, "crop_h": py1 - py0,
            })

        print("[4/5] Storageアップロード完了、DB登録中...")
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/assets",
            headers={**rest_headers(), "Prefer": "return=minimal"},
            json=rows_to_insert,
            timeout=60,
        )
        r.raise_for_status()

        requests.patch(
            f"{SUPABASE_URL}/rest/v1/asset_sheets",
            params={"id": f"eq.{args.sheet_id}"},
            headers=rest_headers(),
            json={
                "status": "done",
                "detected_count": len(boxes),
                "processed_at": datetime.now(timezone.utc).isoformat(),
            },
            timeout=30,
        ).raise_for_status()
        print(f"[5/5] 完了: {len(boxes)}件の素材を登録しました")

    except Exception as e:  # noqa: BLE001 — 失敗理由をasset_sheetsに記録してから再送出する
        mark_failed(args.sheet_id, str(e))
        raise


if __name__ == "__main__":
    main()
