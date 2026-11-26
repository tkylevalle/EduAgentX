"""Turn the Blender renders and the concept sheets into the files the page loads.

    python art/pack.py            (from services/web)

Writes public/school/** and src/school/art/manifest.json. The source images stay in
art/; nothing here draws anything, it only cuts, keys, packs and compresses.
"""
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RENDERS = os.path.join(HERE, 'renders')
CONCEPTS = os.path.join(HERE, 'concepts')
PUBLIC = os.path.join(HERE, '..', 'public', 'school')
MANIFEST = os.path.join(HERE, '..', 'src', 'school', 'art', 'manifest.json')

SHEET_COLS = 4                 # a 24-frame pose is 2048 x 3072, inside every phone's texture limit
ALPHA_FLOOR = 10               # the shadow catcher leaves alpha noise below this in the frame corners
PLATE_W, PLATE_H = 1920, 1080  # the reference frame every anchor is measured in
WIDE = 1.2                     # a room plate covers this much of the reference frame
THUMB_W = 800                  # a campus cell at 2x on a laptop
STICKERS = ('stamp', 'seal', 'rosette', 'star', 'paperclip', 'pin', 'tack', 'tape', 'clip', 'crest', 'pencil', 'chalk')
STICKER_GRID = (4, 3)
TEXTURES = ('chalkboard', 'cork', 'paper', 'walnut')   # left to right, top to bottom on the sheet
TEXTURE_INSET = 0.1            # the share of a quadrant cut from each edge, to lose the sheet's gutters


def _save(image, *path, quality=84):
    target = os.path.join(PUBLIC, *path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    image.save(target, 'WEBP', quality=quality, method=6)
    return os.path.getsize(target)


def _clean(image):
    """Drop the faint alpha noise of the shadow catcher and stretch the rest back to full range."""
    data = np.asarray(image.convert('RGBA')).astype(np.float32)
    alpha = np.clip(data[..., 3] - ALPHA_FLOOR, 0, None) * 255 / (255 - ALPHA_FLOOR)
    data[..., 3] = alpha
    return Image.fromarray(data.astype(np.uint8), 'RGBA')


def _sheet(folder, prefix, count, frame):
    rows = (count + SHEET_COLS - 1) // SHEET_COLS
    sheet = Image.new('RGBA', (SHEET_COLS * frame, rows * frame), (0, 0, 0, 0))
    for index in range(count):
        cell = _clean(Image.open(os.path.join(folder, f'{prefix}{index:02d}.png')))
        sheet.paste(cell, ((index % SHEET_COLS) * frame, (index // SHEET_COLS) * frame))
    return sheet


def pack_quill():
    with open(os.path.join(RENDERS, 'quill', 'frames.json'), encoding='utf-8') as handle:
        frames = json.load(handle)
    size = frames['frame']
    poses = {}
    total = 0
    for name, pose in frames['poses'].items():
        folder = os.path.join(RENDERS, 'quill', name)
        total += _save(_sheet(folder, 'f', pose['frames'], size), 'quill', f'{name}.webp')
        has_cap = pose.get('cap') and os.path.exists(os.path.join(folder, 'c00.png'))
        if has_cap:
            total += _save(_sheet(folder, 'c', pose['frames'], size), 'quill', f'{name}-cap.webp')
        poses[name] = {'frames': pose['frames'], 'fps': pose['fps'], 'cap': bool(has_cap)}
    total += _save(_clean(Image.open(os.path.join(RENDERS, 'quill', 'desk', 'f00.png'))), 'quill', 'desk.webp')
    return {'frame': size, 'cols': SHEET_COLS, 'platePx': frames['framePlatePx'], 'center': frames['centerPlate'],
            'foot': frames['footPlate'], 'poses': poses}, total


def _to_ref(box, size):
    """A pixel box of a wide plate as {x, y, w, h} (left, top, size) in reference plate pixels."""
    scale = PLATE_W * WIDE / size[0]
    left = box[0] * scale - PLATE_W * (WIDE - 1) / 2
    top = box[1] * scale - PLATE_H * (WIDE - 1) / 2
    return {'x': round(left, 1), 'y': round(top, 1), 'w': round((box[2] - box[0]) * scale, 1), 'h': round((box[3] - box[1]) * scale, 1)}


def pack_rooms():
    with open(os.path.join(RENDERS, 'rooms', 'rooms.json'), encoding='utf-8') as handle:
        anchors = json.load(handle)
    rooms, total, shell = {}, 0, None
    for name in anchors:
        back = Image.open(os.path.join(RENDERS, 'rooms', f'{name}-back.png')).convert('RGBA')
        front = Image.open(os.path.join(RENDERS, 'rooms', f'{name}-front.png')).convert('RGBA')
        total += _save(back, 'rooms', f'{name}-back.webp')
        total += _save(front, 'rooms', f'{name}-front.webp')
        box = back.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
        shell = shell or box
        if box != shell:
            raise SystemExit(f'{name}: the box is at {box}, the other rooms are at {shell}')
        whole = Image.alpha_composite(back, front).crop(box)
        thumb = whole.resize((THUMB_W, round(THUMB_W * whole.height / whole.width)), Image.LANCZOS)
        total += _save(thumb, 'rooms', f'{name}-thumb.webp', quality=82)
        rooms[name] = anchors[name]
    return {'wide': WIDE, 'box': _to_ref(shell, back.size), 'thumb': [thumb.width, thumb.height], 'anchors': rooms}, total


def _key_green(image):
    """Cut a pure green background out and take the green cast off what stays."""
    data = np.asarray(image.convert('RGB')).astype(np.float32)
    red, green, blue = data[..., 0], data[..., 1], data[..., 2]
    other = np.maximum(red, blue)
    excess = green - other
    alpha = 1 - np.clip((excess - 30) / 70, 0, 1)
    green = np.minimum(green, other + 12)
    # A shadow on the green screen is dark green: keep it as a soft neutral shadow.
    out = np.dstack([red, green, blue, alpha * 255])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')


def _shapes(mask):
    """The bounding box and the pixel count of every connected shape in a small boolean mask."""
    seen = np.zeros(mask.shape, dtype=bool)
    found = []
    for start in zip(*np.nonzero(mask)):
        if seen[start]:
            continue
        seen[start] = True
        stack, rows, cols = [start], [], []
        while stack:
            row, col = stack.pop()
            rows.append(row)
            cols.append(col)
            for near in ((row + 1, col), (row - 1, col), (row, col + 1), (row, col - 1)):
                if 0 <= near[0] < mask.shape[0] and 0 <= near[1] < mask.shape[1] and mask[near] and not seen[near]:
                    seen[near] = True
                    stack.append(near)
        found.append({'box': (min(cols), min(rows), max(cols) + 1, max(rows) + 1), 'area': len(rows)})
    return found


def pack_stickers():
    """The sheet has twelve objects in a loose 4 x 3 grid. An object can reach into the next cell,
    so each one is cut as a connected shape, then named by the cell its middle is in."""
    keyed = _key_green(Image.open(os.path.join(CONCEPTS, 'stickers.png')))
    step = 4
    small = np.asarray(keyed.getchannel('A').resize((keyed.width // step, keyed.height // step), Image.BILINEAR)) > 60
    shapes = sorted(_shapes(small), key=lambda shape: -shape['area'])[:len(STICKERS)]
    cols, rows = STICKER_GRID
    sizes, total = {}, 0
    for shape in shapes:
        left, top, right, bottom = (edge * step for edge in shape['box'])
        cell = int((top + bottom) / 2 // (keyed.height / rows)) * cols + int((left + right) / 2 // (keyed.width / cols))
        name = STICKERS[cell]
        if name in sizes:
            raise SystemExit(f'sticker {name}: two shapes fell in one cell')
        cut = keyed.crop((max(left - 6, 0), max(top - 6, 0), min(right + 6, keyed.width), min(bottom + 6, keyed.height)))
        total += _save(cut, 'ui', f'{name}.webp', quality=88)
        sizes[name] = [cut.width, cut.height]
    if len(sizes) != len(STICKERS):
        raise SystemExit(f'stickers: found {sorted(sizes)}, expected {len(STICKERS)}')
    return sizes, total


def pack_textures():
    sheet = Image.open(os.path.join(CONCEPTS, 'textures.png')).convert('RGB')
    half_w, half_h = sheet.width // 2, sheet.height // 2
    total = 0
    for index, name in enumerate(TEXTURES):
        left, top = (index % 2) * half_w, (index // 2) * half_h
        inset_x, inset_y = round(half_w * TEXTURE_INSET), round(half_h * TEXTURE_INSET)
        tile = sheet.crop((left + inset_x, top + inset_y, left + half_w - inset_x, top + half_h - inset_y))
        # Mirrored four ways the tile repeats without a seam.
        seamless = Image.new('RGB', (tile.width * 2, tile.height * 2))
        seamless.paste(tile, (0, 0))
        seamless.paste(tile.transpose(Image.FLIP_LEFT_RIGHT), (tile.width, 0))
        seamless.paste(tile.transpose(Image.FLIP_TOP_BOTTOM), (0, tile.height))
        seamless.paste(tile.transpose(Image.ROTATE_180), (tile.width, tile.height))
        total += _save(seamless, 'ui', f'{name}.webp', quality=80)
    return total


def pack_extras():
    with open(os.path.join(RENDERS, 'extras', 'extras.json'), encoding='utf-8') as handle:
        extras = json.load(handle)
    total = _save(Image.open(os.path.join(RENDERS, 'extras', 'roof.png')).convert('RGBA'), 'rooms', 'roof.webp')
    total += _save(Image.open(os.path.join(RENDERS, 'extras', 'wing.png')).convert('RGBA'), 'rooms', 'wing.webp')
    for name in ('books', 'pot', 'lamp'):
        prop = Image.open(os.path.join(RENDERS, 'extras', f'{name}.png')).convert('RGBA')
        total += _save(prop.resize((600, 600), Image.LANCZOS), 'fg', f'{name}.webp', quality=82)
    total += _save(Image.open(os.path.join(CONCEPTS, 'backdrop.png')).convert('RGB'), 'ui', 'backdrop.webp', quality=80)
    return extras, total


def main():
    quill, quill_bytes = pack_quill()
    rooms, room_bytes = pack_rooms()
    stickers, sticker_bytes = pack_stickers()
    texture_bytes = pack_textures()
    extras, extra_bytes = pack_extras()
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, 'w', encoding='utf-8') as handle:
        json.dump({'plate': [PLATE_W, PLATE_H], 'quill': quill, 'rooms': rooms, 'roof': extras['roof'], 'wing': extras['wing'], 'stickers': stickers}, handle, indent=1)
    report = {'quill': quill_bytes, 'rooms': room_bytes, 'stickers': sticker_bytes, 'textures': texture_bytes, 'extras': extra_bytes}
    for name, size in report.items():
        os.sys.stdout.write(f'{name:9s} {size / 1e6:6.2f} MB\n')
    os.sys.stdout.write(f'total     {sum(report.values()) / 1e6:6.2f} MB\n')


if __name__ == '__main__':
    main()
