"""The diorama rooms: one open-front plywood box per place in the school.

    blender --background --python art/blender/rooms.py -- review [room…]   one small frame per room
    blender --background --python art/blender/rooms.py -- render [room…]   the back plate and the front layer

A room is rendered twice with a transparent film. The back plate has everything
Quill stands in front of; the front layer has the few things Quill walks behind.
The page puts Quill's sprite between the two. `rooms.json` gives the place of each
board, clock and lamp in reference plate pixels, so the page can draw real data there.
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402
from kit import ROBOT_Y, ROOM_D, ROOM_H, ROOM_W, area_light, box, empty, spot_light  # noqa: E402
from mats import grain, project_ref, tree, wide_camera  # noqa: E402
from props import GRAINS, mat, paint  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'renders', 'rooms')
T = 0.28                       # thickness of the plywood the boxes are made of
BACK = ROOM_D - 0.02           # the painted face of the back wall
HALF = ROOM_W / 2
DOOR_Y0, DOOR_Y1, DOOR_H = 1.0, 2.7, 2.9   # the doorway in each side wall; Quill walks through at ROBOT_Y
RAFTERS = (1.6, 3.6)           # lamps hang from these
DADO_H = 1.25                  # the wood panelling on the lower back wall
REVIEW_SCALE, REVIEW_SAMPLES = 0.4, 40
PLATE_SCALE, PLATE_SAMPLES = 1.25, 110     # 2400 x 1350, enough for a 2x display at laptop width
# In a box the walls bounce the light back, so a room takes half of the rig's strength and
# stays darker than the robot, which is lit in the open.
ROOM_KEY = 0.5
# Quill is a toy 2.5 units tall with a big head. Armchairs, shelves and tables grow by this much so they
# do not look like doll furniture next to it; the pupils' desks stay the size of Quill's own desk.
FURNITURE_SCALE = 1.4


class Room:
    """The parts of one diorama: its root, the objects in front of Quill and the named anchors."""

    def __init__(self, name, key=ROOM_KEY):
        self.name = name
        self.key = key
        self.root = empty(name)
        self.front = []
        self.anchors = {}

    def put(self, builder, loc, *args, front=False, s=None, **kwargs):
        """Place a piece of furniture. It grows by `s` about its origin, and so does its height above the floor,
        so a thing put on a table stays on the table."""
        s = FURNITURE_SCALE if s is None else s
        obj = builder(self.root, (loc[0], loc[1], loc[2] * s), *args, **kwargs)
        obj.scale = tuple(value * s for value in obj.scale)
        if front:
            self.front.append(obj)
        return obj

    def wall(self, builder, loc, *args, **kwargs):
        """Place something that already has its full size: a board, a window, a lamp, a pupil's desk."""
        return self.put(builder, loc, *args, s=1.0, **kwargs)

    def anchor(self, key, x, z, width, height, y=BACK):
        """A rectangle on a wall (or a point when the size is 0) that the page draws on."""
        self.anchors[key] = (x, y, z, width, height)


def _floor(room, floor):
    light, dark, _scale, rough, coat, bump = GRAINS[floor]
    boards = grain(f'floor_{floor}', light, dark, (9, 0.7, 9) if floor != 'stone' else (4, 4, 4), rough, coat, bump)
    box('slab', (ROOM_W + 2 * T, ROOM_D + T, T), mat('ply'), room.root, (0, (ROOM_D + T) / 2, -T / 2), bevel=0.02)
    box('floor', (ROOM_W, ROOM_D, 0.02), boards, room.root, (0, ROOM_D / 2, 0), bevel=0)
    seams = 16 if floor != 'stone' else 8
    for k in range(1, seams):
        box('seam', (0.014, ROOM_D, 0.004), mat('walnut'), room.root, (-HALF + k * ROOM_W / seams, ROOM_D / 2, 0.011), bevel=0)
    if floor == 'stone':
        for k in range(1, 5):
            box('seam', (ROOM_W, 0.014, 0.004), mat('walnut'), room.root, (0, k * ROOM_D / 5, 0.011), bevel=0)


def _side_wall(room, sx, wall):
    x = sx * (HALF + T / 2)
    face = sx * (HALF - 0.01)
    parts = [  # (y0, y1, z0, z1, in front of Quill)
        (0.0, DOOR_Y0, 0.0, ROOM_H + T, True),
        (DOOR_Y1, ROOM_D, 0.0, ROOM_H + T, False),
        (DOOR_Y0, DOOR_Y1, DOOR_H, ROOM_H + T, False),
    ]
    for y0, y1, z0, z1, front in parts:
        ply = box('side', (T, y1 - y0, z1 - z0), mat('ply'), room.root, (x, (y0 + y1) / 2, (z0 + z1) / 2), bevel=0.015)
        top = min(z1, ROOM_H)
        low = max(z0, 0.0)
        skin = box('side_paint', (0.02, min(y1, ROOM_D) - y0, top - low), wall, room.root, (face, (y0 + min(y1, ROOM_D)) / 2, (low + top) / 2), bevel=0)
        if front:
            room.front += [ply, skin]


def shell(room, wall, floor='oak', dado='oak_dark', backdrop=None):
    """The plywood box: floor, back wall, two side walls with a doorway each, a top beam and two rafters."""
    wall_mat = paint(wall)
    _floor(room, floor)
    box('back', (ROOM_W + 2 * T, T, ROOM_H + 2 * T), mat('ply'), room.root, (0, ROOM_D + T / 2, ROOM_H / 2), bevel=0.015)
    box('back_paint', (ROOM_W, 0.02, ROOM_H), backdrop or wall_mat, room.root, (0, ROOM_D - 0.01, ROOM_H / 2), bevel=0)
    for sx in (-1, 1):
        _side_wall(room, sx, wall_mat)
    box('beam', (ROOM_W, T, 0.5), mat('ply'), room.root, (0, T / 2, ROOM_H + T - 0.25), bevel=0.015)
    for y in RAFTERS:
        box('rafter', (ROOM_W, 0.14, 0.22), mat('oak_dark'), room.root, (0, y, ROOM_H - 0.11), bevel=0.02)
    if dado:
        light, dark, _scale, rough, coat, bump = GRAINS[dado]
        boards = grain(f'dado_{dado}', light, dark, (12, 12, 0.7), rough, coat, bump)   # the grain runs up the wall
        box('dado', (ROOM_W, 0.05, DADO_H), boards, room.root, (0, BACK - 0.025, DADO_H / 2), bevel=0.006)
        for k in range(1, 24):
            box('dado_seam', (0.012, 0.01, DADO_H - 0.04), mat('walnut'), room.root, (-HALF + k * ROOM_W / 24, BACK - 0.052, DADO_H / 2), bevel=0)
        box('dado_rail', (ROOM_W, 0.09, 0.07), mat(dado), room.root, (0, BACK - 0.045, DADO_H + 0.03), bevel=0.012)
    box('skirting', (ROOM_W, 0.07, 0.16), mat(dado or 'stone'), room.root, (0, BACK - 0.035, 0.08), bevel=0.012)


def room_lights(strength):
    """The light of a room. The robot's own rig has its key high on the left; in a box that key
    shines over the top beam and past the side wall, and their shadows cut a hard diagonal edge
    across the back wall. Here the key is a large panel low in front of the opening: it sees the
    whole back wall under the beam, so the wall is lit evenly and shadows are soft. It still comes
    from the left, as on the robot."""
    focus = (0.0, 2.6, 2.2)
    area_light('key', (-2.4, -9.6, 4.3), focus, 3000 * strength, (1.0, 0.86, 0.7), 8.0)
    area_light('fill', (5.0, -8.0, 2.4), focus, 420 * strength, (0.72, 0.84, 1.0), 7.0)
    # No rim light here: behind the robot's spot it is half a unit from the back wall and paints a bright wedge on it.
    area_light('ceiling', (0, 2.4, ROOM_H - 0.35), (0, 2.4, 0), 520 * strength, (1.0, 0.9, 0.78), 5.0)
    spot_light('pendant', (0, ROBOT_Y - 0.4, 4.5), (0, ROBOT_Y - 0.1, 0), 800 * strength, (1.0, 0.8, 0.55), 84, 0.9, 0.5)


def _rect(anchor):
    """An anchor as {x, y, w, h} in reference plate pixels (the centre and the size)."""
    x, y, z, width, height = anchor
    left, top = project_ref((x - width / 2, y, z + height / 2))
    right, bottom = project_ref((x + width / 2, y, z - height / 2))
    return {'x': round((left + right) / 2, 1), 'y': round((top + bottom) / 2, 1),
            'w': round(right - left, 1), 'h': round(bottom - top, 1)}


def _render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def _split(room, front_pass):
    front = {node for obj in room.front for node in tree(obj)}
    for obj in bpy.context.scene.objects:
        if obj.type in ('MESH', 'CURVE', 'FONT'):
            obj.visible_camera = (obj in front) == front_pass


def render_room(name, builder, final):
    scene = kit.reset_scene()
    room = builder()
    room_lights(room.key)
    wide_camera(PLATE_SCALE if final else REVIEW_SCALE)
    scene.cycles.samples = PLATE_SAMPLES if final else REVIEW_SAMPLES
    anchors = {key: _rect(value) for key, value in room.anchors.items()}
    if not final:
        _render(os.path.join(OUT, '_review', f'{name}.png'))
        return anchors
    _split(room, False)
    _render(os.path.join(OUT, f'{name}-back.png'))
    _split(room, True)
    _render(os.path.join(OUT, f'{name}-front.png'))
    return anchors


def main():
    import sets
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['review']
    mode, names = args[0], args[1:] or list(sets.SETS)
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'rooms.json')
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as handle:
            manifest = json.load(handle)
    for name in names:
        manifest[name] = render_room(name, sets.SETS[name], mode == 'render')
        with open(manifest_path, 'w', encoding='utf-8') as handle:
            json.dump(manifest, handle, indent=2)


if __name__ == '__main__':
    main()
