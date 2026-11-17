"""Sprites that are not a room: the school roof for the campus view, and the props
that sit out of focus in front of the stage.

    blender --background --python art/blender/extras.py -- roof
    blender --background --python art/blender/extras.py -- props

The campus has five rooms on the ground floor and four above them. The main roof
covers the upper four; a small wing roof covers the half room that sticks out at
each end. Both are drawn with a flat (orthographic) camera, so they line up with a
row of room boxes at any size. `extras.json` gives the place of the tower clock as
fractions of the roof image; the page draws the real time there.
"""
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import furniture as f  # noqa: E402
import kit  # noqa: E402
import props as p  # noqa: E402
from kit import aim, area_light, ball, box, cone, empty, material, plate, tube  # noqa: E402
from mats import bricks, grain, tree  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'renders', 'extras')
BOX_W = 10.16                  # the outer width of one room box
MAIN_BOXES = 4                 # the upper floor has four rooms
ROOF_W = MAIN_BOXES * BOX_W + 1.3   # the roof covers them and hangs over each end
ROOF_VIEW = 45.0               # world units across the roof image
ROOF_PX = (3000, 600)
ROOF_CAM_Z = 3.6
ROWS, ROW_RISE, ROW_RUN, ROW_TAPER = 9, 0.33, 0.27, 0.26
WING_W, WING_ROWS = BOX_W / 2 + 1.0, 5   # the wing roof covers half a box
WING_VIEW, WING_PX, WING_CAM_Z = 7.0, (1120, 448), 1.0
TILE_W, TILE_GAP = 0.62, 0.03
TOWER_Y, TOWER_W, TOWER_D, TOWER_H = 0.6, 3.4, 1.8, 4.6
CLOCK_Z, CLOCK_R = 3.3, 0.9
DORMER_X, CHIMNEY_X = 11.5, 17.2
PROP_PX, PROP_SAMPLES = 800, 72
SLATES = ('#56606B', '#4A545F', '#636D78')


def _sun(name, direction, energy, color):
    data = bpy.data.lights.new(name, 'SUN')
    data.energy = energy
    data.color = color
    data.angle = math.radians(6)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (-direction[0] * 20, -direction[1] * 20, -direction[2] * 20)
    aim(obj, (0, 0, 0))
    return obj


def _ortho_camera(location, target, scale, size):
    scene = bpy.context.scene
    data = bpy.data.cameras.new('camera')
    data.type = 'ORTHO'
    data.ortho_scale = scale
    obj = bpy.data.objects.new('camera', data)
    scene.collection.objects.link(obj)
    obj.location = location
    aim(obj, target)
    scene.camera = obj
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    return obj


def _shingles(root, width=ROOF_W, rows=ROWS):
    slates = [material(f'slate_{k}', color, rough=0.8) for k, color in enumerate(SLATES)]
    under = material('slate_under', '#2E343B', rough=0.9)
    pick = f.rand(11)
    tilt = -math.atan2(ROW_RUN, ROW_RISE) * 0.8
    for row in range(rows):
        half = width / 2 - row * ROW_TAPER
        z, y = 0.36 + row * ROW_RISE, row * ROW_RUN
        box('row_under', (half * 2, 0.04, 0.44), under, root, (0, y + 0.06, z + 0.02), rot=(tilt, 0, 0), bevel=0)
        x = -half + (TILE_W / 2 if row % 2 else 0)
        while x + TILE_W <= half:
            box('tile', (TILE_W - TILE_GAP, 0.05, 0.42), slates[int(next(pick) * 3)], root,
                (x + TILE_W / 2, y, z), rot=(tilt + (next(pick) - 0.5) * 0.05, 0, 0), bevel=0.012)
            x += TILE_W
    ridge_half = width / 2 - rows * ROW_TAPER
    box('ridge', (ridge_half * 2, 0.3, 0.2), material('ridge', '#3A424B', rough=0.7), root,
        (0, rows * ROW_RUN, 0.36 + rows * ROW_RISE - 0.08), bevel=0.05)
    box('fascia', (width + 0.3, 0.5, 0.36), p.mat('ply'), root, (0, -0.1, 0.1), bevel=0.02)
    box('gutter', (width + 0.5, 0.2, 0.1), p.mat('brass'), root, (0, -0.32, 0.3), bevel=0.03)


def _tower(root):
    plaster = grain('tower_plaster', '#DCCBAA', '#CDB993', (3, 3, 3), 0.9, 0.0, 0.2)
    face = TOWER_Y - TOWER_D / 2
    box('tower', (TOWER_W, TOWER_D, TOWER_H), plaster, root, (0, TOWER_Y, TOWER_H / 2), bevel=0.03)
    for sx in (-1, 1):
        box('tower_trim', (0.24, 0.12, TOWER_H), p.mat('oak_dark'), root, (sx * (TOWER_W / 2 - 0.12), face - 0.05, TOWER_H / 2), bevel=0.02)
    box('tower_band', (TOWER_W + 0.1, 0.14, 0.22), p.mat('oak_dark'), root, (0, face - 0.05, 2.12), bevel=0.02)
    box('cornice', (TOWER_W + 0.6, TOWER_D + 0.6, 0.3), p.mat('oak_dark'), root, (0, TOWER_Y, TOWER_H + 0.15), bevel=0.04)
    f.wall_clock(root, (0, face, CLOCK_Z), radius=CLOCK_R)
    f.window(root, (0, face, 1.3), width=0.9, height=0.9, light=0)
    top = TOWER_H + 0.3
    cone('spire', 2.75, 0.1, 1.9, material('slate_0', SLATES[0], rough=0.8), root, (0, TOWER_Y, top + 0.95), sides=4, bevel=0.03, spin=math.pi / 4)
    ball('finial', 0.17, p.mat('brass'), root, (0, TOWER_Y, top + 1.95))
    tube('pole', [(0, TOWER_Y, top + 1.9), (0, TOWER_Y, top + 2.9)], 0.035, p.mat('brass'), root)
    flag = [(0, 0.3), (1.25, 0.2), (0.95, 0), (1.25, -0.2), (0, -0.3)]
    plate('flag', flag, 0.02, p.mat('yellow'), root, (0.04, TOWER_Y - 0.01, top + 2.55))


def _dormer(root, x):
    plaster = grain('tower_plaster', '#DCCBAA', '#CDB993', (3, 3, 3), 0.9, 0.0, 0.2)
    box('dormer', (2.2, 1.2, 1.9), plaster, root, (x, 0.4, 0.36 + 0.95), bevel=0.03)
    plate('dormer_roof', [(-1.45, 0), (1.45, 0), (0, 1.05)], 1.3, material('slate_1', SLATES[1], rough=0.8), root, (x, -0.3, 2.26))
    f.window(root, (x, -0.2, 1.32), width=1.0, height=1.1, light=0)


def _chimney(root, x):
    wall = bricks('chimney_brick', '#9C5A43', '#8A4C38', '#D8C7A9', scale=5.0)
    box('chimney', (1.0, 1.0, 2.9), wall, root, (x, 1.7, 2.75), bevel=0.02)
    box('chimney_cap', (1.25, 1.25, 0.18), p.mat('stone'), root, (x, 1.7, 4.29), bevel=0.03)
    cone('chimney_pot', 0.2, 0.24, 0.45, p.mat('terracotta'), root, (x, 1.7, 4.6), sides=24, bevel=0.02)


def render_roof():
    scene = kit.reset_scene()
    root = empty('roof')
    _shingles(root)
    _tower(root)
    for x in (-DORMER_X, DORMER_X):
        _dormer(root, x)
    for x in (-CHIMNEY_X, CHIMNEY_X):
        _chimney(root, x)
    _sun('key', (0.5, 0.62, -0.6), 3.4, (1.0, 0.86, 0.68))
    _sun('fill', (-0.6, 0.7, -0.2), 0.7, (0.72, 0.84, 1.0))
    _ortho_camera((0, -40, ROOF_CAM_Z), (0, 0, ROOF_CAM_Z), ROOF_VIEW, ROOF_PX)
    scene.cycles.samples = 96
    scene.render.filepath = os.path.join(OUT, 'roof.png')
    bpy.ops.render.render(write_still=True)
    width, height = ROOF_PX
    unit = width / ROOF_VIEW
    return {'w': width, 'h': height, 'boxes': round(MAIN_BOXES * BOX_W * unit / width, 4),
            'eaves': round((height / 2 + ROOF_CAM_Z * unit) / height, 4),
            'clock': {'x': 0.5, 'y': round((height / 2 - (CLOCK_Z - ROOF_CAM_Z) * unit) / height, 4),
                      'w': round(2 * CLOCK_R * 0.86 * unit / width, 4), 'h': round(2 * CLOCK_R * 0.86 * unit / height, 4)}}


def render_wing():
    """The low roof over the half room at each end of the ground floor."""
    scene = kit.reset_scene()
    root = empty('wing')
    _shingles(root, WING_W, WING_ROWS)
    _sun('key', (0.5, 0.62, -0.6), 3.4, (1.0, 0.86, 0.68))
    _sun('fill', (-0.6, 0.7, -0.2), 0.7, (0.72, 0.84, 1.0))
    _ortho_camera((0, -40, WING_CAM_Z), (0, 0, WING_CAM_Z), WING_VIEW, WING_PX)
    scene.cycles.samples = 96
    scene.render.filepath = os.path.join(OUT, 'wing.png')
    bpy.ops.render.render(write_still=True)
    width, height = WING_PX
    unit = width / WING_VIEW
    return {'w': width, 'h': height, 'half': round(BOX_W / 2 * unit / width, 4),
            'eaves': round((height / 2 + WING_CAM_Z * unit) / height, 4)}


def _books(root):
    p.book_stack(root, (0, 0, 0), ('navy', 'red', 'green', 'manila', 'teal'), spin=0.16)


def _pot(root):
    f.pencil_pot(root, (0, 0, 0), scale=2.0)


def _lamp(root):
    f.banker_lamp(root, (0, 0, 0), power=6)


PROPS = {'books': _books, 'pot': _pot, 'lamp': _lamp}


def render_prop(name, builder):
    """One prop alone, seen a little from above, with the camera fitted to it."""
    scene = kit.reset_scene()
    root = empty(name)
    builder(root)
    area_light('key', (-1.4, -1.8, 2.0), (0, 0, 0.15), 110, (1.0, 0.84, 0.66), 1.2)
    area_light('fill', (1.8, -1.6, 0.6), (0, 0, 0.15), 22, (0.72, 0.84, 1.0), 2.0)
    area_light('rim', (0.8, 1.2, 1.2), (0, 0, 0.2), 60, (1.0, 0.9, 0.78), 0.6)
    camera = _ortho_camera((0, -6, 1.5), (0, 0, 0.15), 1.0, (PROP_PX, PROP_PX))
    bpy.context.view_layer.update()
    corners = []
    for obj in tree(root):
        if obj.type == 'MESH':
            for corner in obj.bound_box:
                corners.extend(obj.matrix_world @ __import__('mathutils').Vector(corner))
    location, scale = camera.camera_fit_coords(bpy.context.evaluated_depsgraph_get(), corners)
    camera.location = location
    camera.data.ortho_scale = scale * 1.12
    scene.cycles.samples = PROP_SAMPLES
    scene.render.filepath = os.path.join(OUT, f'{name}.png')
    bpy.ops.render.render(write_still=True)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['roof']
    os.makedirs(OUT, exist_ok=True)
    if args[0] == 'roof':
        with open(os.path.join(OUT, 'extras.json'), 'w', encoding='utf-8') as handle:
            json.dump({'roof': render_roof(), 'wing': render_wing()}, handle, indent=2)
        return
    for name in args[1:] or list(PROPS):
        render_prop(name, PROPS[name])


if __name__ == '__main__':
    main()
