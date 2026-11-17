"""Tile the review frames in art/renders/quill/_sheet into one image on a neutral ground."""
import pathlib
import sys

from PIL import Image

folder = pathlib.Path(__file__).resolve().parent.parent / 'renders' / 'quill' / '_sheet'
files = sorted(folder.glob('*.png'))
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 6
size = Image.open(files[0]).size[0]
rows = -(-len(files) // cols)
sheet = Image.new('RGB', (cols * size, rows * size), (58, 52, 48))
for index, path in enumerate(files):
    frame = Image.open(path).convert('RGBA')
    sheet.paste(frame, ((index % cols) * size, (index // cols) * size), frame)
sheet.save(sys.argv[1], quality=88)
