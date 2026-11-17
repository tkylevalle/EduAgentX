"""The set dressing of each room. A builder returns a `Room`; `SETS` maps the
room's name in the app to its builder. Quill stands at x = 0, y = ROBOT_Y, so
that spot stays clear, and the few things nearer the camera go in the front layer.

`room.put` grows a piece of furniture to Quill's scale; `room.wall` keeps the size
as written (boards, windows, lamps and the pupils' desks).
"""
import math

import furniture as f
import props as p
from kit import ROOM_D, ROOM_H, ROOM_W, ball, box, cone, empty, material, plate, rounded_rect, tube
from mats import bricks, point_light, sky
from props import mat
from rooms import BACK, HALF, RAFTERS, Room, shell

HALF_PI = math.pi / 2
FRONT_Y = 0.72          # the row of furniture between Quill and the camera
BUNTING = ('red', 'yellow', 'navy', 'cream')
LAMP_Z = ROOM_H - 0.2   # where a pendant lamp meets its rafter
# A short cord keeps every shade up at the rafters. On a long cord the shades hung in front of the boards,
# clocks and pennants on the back wall.
LAMP_DROP = 0.5


def arch(width, height, steps=12):
    """The outline of a door or window with a round top."""
    r = width / 2
    curve = [(r * math.cos(math.radians(a)), height - r + r * math.sin(math.radians(a))) for a in range(0, 181, 180 // steps)]
    return [(-r, 0), (r, 0)] + curve


def bunting(root, x0, x1, y, z, sag=0.4, count=13):
    line = [(x0 + (x1 - x0) * k / 24, y, z - sag * math.sin(math.pi * k / 24)) for k in range(25)]
    tube('bunting_line', line, 0.008, mat('cream'), root)
    for k in range(count):
        part = (k + 0.5) / count
        loc = (x0 + (x1 - x0) * part, y, z - sag * math.sin(math.pi * part))
        plate('bunting_flag', [(-0.15, 0), (0.15, 0), (0, -0.32)], 0.006, mat(BUNTING[k % len(BUNTING)]), root, loc)


def school_desk(room, x, y, front=False, books=None):
    """A pupil's desk with its chair behind it (or in front of it, seen from the back, in the front row)."""
    room.wall(p.desk, (x, y, 0), front=front)
    if front:
        room.wall(f.side_chair, (x, y - 0.55, 0), math.pi, front=True)
    else:
        room.wall(f.side_chair, (x, y + 0.6, 0))
    if books:
        room.wall(p.book_stack, (x + 0.3, y, 0.66), books, front=front)


def _lamppost(root, loc):
    x, y, _ = loc
    cone('post_base', 0.16, 0.09, 0.4, mat('iron'), root, (x, y, 0.2), sides=20)
    tube('post', [(x, y, 0.3), (x, y, 3.2)], 0.045, mat('iron'), root)
    box('lantern', (0.3, 0.3, 0.42), material('lantern_glow', '#FFD58A', rough=0.4, emit=7.0), root, (x, y, 3.42), bevel=0.02)
    cone('lantern_cap', 0.28, 0.03, 0.2, mat('iron'), root, (x, y, 3.74), sides=4)
    point_light('lantern_light', root, (x, y - 0.3, 3.4), 70)


LEAVES = ('#4E8F55', '#3C7848', '#6BA765')   # three greens, so the crown reads as leaves and not as one lump
CROWN = (0.95, 0.5, 0.85)                     # half the width, depth and height of the tree's crown


def _tree(root, loc):
    """A small tree in blossom: a trunk with three boughs, a crown of many small leaf clumps and a few flowers."""
    x, y, _ = loc
    top = 3.3
    cone('trunk', 0.17, 0.09, 2.5, mat('walnut'), root, (x, y, 1.25), sides=14)
    for dx, dz in ((-0.55, 0.45), (0.5, 0.55), (0.05, 0.75)):
        tube('bough', [(x, y, 2.2), (x + dx * 0.6, y, 2.2 + dz * 0.7), (x + dx, y, 2.4 + dz)], 0.05, mat('walnut'), root)
    greens = [material(f'leaf_{k}', color, rough=0.85) for k, color in enumerate(LEAVES)]
    numbers = f.rand(23)
    for k in range(64):
        # A point inside the crown: the three numbers are pulled towards the middle, so the edge is ragged, not a ball.
        px, py, pz = ((next(numbers) + next(numbers) - 1.0) for _ in range(3))
        ball('leaves', 0.2 + 0.16 * next(numbers), greens[k % 3], root,
             (x + px * CROWN[0], y + py * CROWN[1], top + pz * CROWN[2]))
    for k in range(14):
        px, pz = next(numbers) * 2 - 1, next(numbers) * 2 - 1
        ball('flower', 0.075, mat('pink' if k % 4 else 'paper'), root,
             (x + px * CROWN[0] * 0.8, y - CROWN[1] * 0.75 - 0.12, top + pz * CROWN[2] * 0.75))


def gate():
    room = Room('gate')
    shell(room, '#6E8FC2', 'stone', dado=None, backdrop=sky('sky_dusk', '#F6C78E', '#3F62A6', ROOM_H))
    r = room.root
    face = ROOM_D - 0.55                     # the front of the school building
    brick = bricks('school_brick', '#A65C42', '#8C4935', '#D8CBB5')
    box('facade', (6.6, 0.5, 4.5), brick, r, (0.3, ROOM_D - 0.3, 2.25), bevel=0.02)
    box('facade_cap', (6.9, 0.62, 0.22), mat('stone'), r, (0.3, ROOM_D - 0.3, 4.6), bevel=0.03)
    box('facade_plinth', (6.8, 0.6, 0.3), mat('stone'), r, (0.3, ROOM_D - 0.32, 0.15), bevel=0.03)
    for width, depth, height in ((2.8, 0.6, 0.15), (2.4, 0.32, 0.3)):
        box('step', (width, depth, height), mat('stone'), r, (0.3, face - depth / 2, height / 2), bevel=0.02)
    plate('door_stone', arch(2.1, 3.25), 0.08, mat('stone'), r, (0.3, face - 0.03, 0.3))
    plate('door_leaf', arch(1.7, 3.0), 0.06, mat('walnut'), r, (0.3, face - 0.1, 0.3))
    box('door_gap', (0.025, 0.02, 2.1), mat('ink'), r, (0.3, face - 0.16, 1.4), bevel=0)
    for sx in (-1, 1):
        ball('door_knob', 0.05, mat('brass'), r, (0.3 + sx * 0.14, face - 0.18, 1.5))
    cone('crest', 0.3, 0.3, 0.05, mat('gold'), r, (0.3, face - 0.03, 3.95), rot=(HALF_PI, 0, 0), sides=40, bevel=0.01)
    room.wall(f.cork_board, (-2.0, face, 2.15), 1.7, 1.3)
    room.anchor('board', -2.0, 2.15, 1.7, 1.3, face - 0.09)
    for x, z, w, h in ((-2.0, 3.75, 1.1, 0.9), (2.55, 3.75, 1.1, 0.9), (2.55, 2.0, 1.1, 1.5)):
        room.wall(f.window, (x, face, z), w, h, light=45)
    box('grass', (ROOM_W, 1.5, 0.03), mat('leaf'), r, (0, 3.7, 0.016), bevel=0)
    box('path', (2.6, ROOM_D - 0.6, 0.036), mat('plaster'), r, (0.3, (ROOM_D - 0.6) / 2, 0.018), bevel=0)
    box('hedge', (1.6, 0.6, 0.85), mat('leaf'), r, (-3.95, 4.6, 0.42), bevel=0.2, segments=5)
    _lamppost(r, (-4.0, 3.5, 0))
    _tree(r, (3.55, 3.9, 0))
    for sx in (-1, 1):
        post = box('gate_post', (0.55, 0.55, 1.9), mat('stone'), r, (sx * 4.2, 0.5, 0.95), bevel=0.03)
        cap = box('gate_cap', (0.7, 0.7, 0.14), mat('stone'), r, (sx * 4.2, 0.5, 1.97), bevel=0.03)
        orb = ball('gate_orb', 0.2, mat('stone'), r, (sx * 4.2, 0.5, 2.2))
        room.front += [post, cap, orb]
    return room


def classroom():
    room = Room('classroom')
    shell(room, '#D8BC86')
    room.wall(f.chalkboard, (0.0, BACK, 3.2), 4.6, 2.1)
    room.anchor('board', 0.0, 3.2, 4.6, 2.1, BACK - 0.085)
    room.wall(f.window, (3.6, BACK, 3.25), 1.5, 2.1)
    room.put(f.bookshelf, (-3.7, BACK - 0.3, 0), 1.45, 2.45, 4, seed=4)
    room.wall(f.wall_clock, (-3.7, BACK, 4.45), 0.4)
    room.anchor('clock', -3.7, 4.45, 0.69, 0.69, BACK - 0.1)
    room.put(f.plant, (4.25, 4.3, 0), 1.2)
    for x in (-2.3, 2.3):
        room.wall(f.pendant_lamp, (x, RAFTERS[0], LAMP_Z), LAMP_DROP, 110, 'green', 0.42)
        school_desk(room, x, 3.4, books=('navy', 'red') if x < 0 else ('green', 'manila', 'red'))
    school_desk(room, 0.0, 4.15)
    school_desk(room, -3.5, FRONT_Y, front=True, books=('teal', 'red'))
    school_desk(room, 3.5, FRONT_Y, front=True)
    room.wall(f.pencil_pot, (3.2, FRONT_Y, 0.66), 1.3, front=True)
    return room


def exam():
    room = Room('exam')
    shell(room, '#5B7594')
    r = room.root
    room.wall(f.chalkboard, (0.8, BACK, 3.2), 4.4, 2.1)
    room.anchor('board', 0.8, 3.2, 4.4, 2.1, BACK - 0.085)
    room.wall(f.pennant, (-3.9, BACK, 3.95), color='navy')
    room.wall(f.pennant, (-2.95, BACK, 3.95), color='red')
    room.wall(f.wall_clock, (3.95, BACK, 4.2), 0.4)
    room.anchor('clock', 3.95, 4.2, 0.69, 0.69, BACK - 0.1)
    room.put(f.filing_cabinet, (-4.05, 4.5, 0), 3)
    room.put(f.plant, (-4.05, 4.5, 1.5), 0.7)
    room.wall(f.pendant_lamp, (0, RAFTERS[0], LAMP_Z), LAMP_DROP, 60, 'green', 0.46)
    for x in (-2.5, 0.0, 2.5):
        y = 3.5 if x else 4.2
        school_desk(room, x, y)
        room.wall(p.paper_sheet, (x, y - 0.05, 0.665))
    for x in (-3.5, 3.5):
        school_desk(room, x, FRONT_Y, front=True)
        room.wall(p.paper_sheet, (x, FRONT_Y, 0.665), front=True)
        room.wall(p.pencil, (x + 0.35, FRONT_Y, 0.675), (0, 0, 0.5), front=True)
    box('exam_line', (ROOM_W, 0.08, 0.004), mat('cream'), r, (0, 2.9, 0.012), bevel=0)
    return room


def office():
    room = Room('office')
    shell(room, '#35594C', 'oak_dark', 'walnut')
    room.wall(f.cork_board, (2.75, BACK, 3.4), 3.0, 1.8)
    room.anchor('board', 2.75, 3.4, 3.0, 1.8, BACK - 0.09)
    room.wall(f.window, (-2.7, BACK, 3.3), 1.5, 2.2, curtains='red')
    room.put(f.bookshelf, (0.05, BACK - 0.3, 0), 1.3, 1.45, 2, seed=9, wood='walnut')
    room.put(f.trophy, (-0.3, BACK - 0.3, 1.5), 1.3)
    room.put(f.globe, (0.45, BACK - 0.3, 1.5))
    room.wall(f.pennant, (0.05, BACK, 4.3), color='red')
    room.put(f.office_desk, (2.75, 3.65, 0), 2.3)
    room.put(f.banker_lamp, (3.75, 3.6, 0.82))
    room.put(p.book_stack, (1.75, 3.7, 0.82), ('navy', 'red'))
    room.put(p.paper_sheet, (2.7, 3.35, 0.825))
    room.put(f.armchair, (-3.2, 3.5, 0), 0.35)
    room.put(f.plant, (-4.35, 4.5, 0), 1.25)
    room.put(f.rug, (0, 2.0, 0), (4.4, 2.1))
    room.wall(f.pendant_lamp, (-1.35, RAFTERS[1], LAMP_Z), LAMP_DROP, 70, 'brass', 0.42)   # clear of the pennant
    room.put(f.filing_cabinet, (4.15, FRONT_Y - 0.15, 0), 3, 0.7, 0.6, 1.1, '#7C6A4F', front=True)
    room.put(f.plant, (4.15, FRONT_Y - 0.15, 1.1), 0.8, front=True)
    return room


def hall():
    room = Room('hall')
    shell(room, '#22304F', 'oak', 'walnut')
    r = room.root
    stage = 0.34
    box('stage', (7.2, 2.0, stage), mat('oak_pale'), r, (0, ROOM_D - 1.0, stage / 2), bevel=0.02)
    box('stage_front', (7.2, 0.04, 0.3), mat('walnut'), r, (0, ROOM_D - 2.02, 0.15), bevel=0.008)
    for sx in (-1, 1):
        room.wall(f.curtain, (sx * 3.95, BACK - 0.2, stage), 1.5, 4.5, 6)
    box('valance', (ROOM_W, 0.24, 0.55), mat('red'), r, (0, BACK - 0.2, ROOM_H - 0.5), bevel=0.08, segments=4)
    tube('valance_rod', [(-HALF, BACK - 0.34, ROOM_H - 0.78), (HALF, BACK - 0.34, ROOM_H - 0.78)], 0.03, mat('gold'), r)
    plate('banner', rounded_rect(3.0, 1.7, 0.05), 0.02, mat('manila'), r, (0, BACK - 0.05, 3.35))
    plate('banner_trim', rounded_rect(3.2, 1.9, 0.08), 0.03, mat('walnut'), r, (0, BACK - 0.03, 3.35))   # a dark frame; gold read as a flat yellow slab
    room.anchor('board', 0, 3.35, 3.0, 1.7, BACK - 0.07)
    box('lectern', (0.9, 0.6, 1.5), mat('walnut'), r, (-2.4, ROOM_D - 1.2, stage + 0.75), bevel=0.03)
    box('lectern_top', (1.05, 0.72, 0.07), mat('oak'), r, (-2.4, ROOM_D - 1.25, stage + 1.56), rot=(0.3, 0, 0), bevel=0.015)
    box('plinth', (0.8, 0.8, 1.1), mat('walnut'), r, (2.4, ROOM_D - 1.2, stage + 0.55), bevel=0.03)
    room.wall(f.trophy, (2.4, ROOM_D - 1.2, stage + 1.1), 2.8)
    bunting(r, -HALF, HALF, 2.6, ROOM_H - 0.25)
    room.wall(f.rug, (0, 1.55, 0), (3.0, 2.9))
    for x in (-4.15, -3.3, 3.3, 4.15):
        room.put(f.side_chair, (x, FRONT_Y - 0.2, 0), math.pi, s=1.25, front=True)
    for x in (-1.6, 1.6):
        point_light('foot_light', r, (x, ROOM_D - 2.3, 0.5), 45)
    return room


def library():
    room = Room('library')
    shell(room, '#6A4A38', 'oak_dark', 'walnut')
    for index, x in enumerate((-3.85, -1.95, 1.95, 3.85)):
        room.wall(f.bookshelf, (x, BACK - 0.23, 0), 1.85, 4.3, 6, seed=20 + index, wood='walnut')
    room.wall(f.window, (0, BACK, 3.5), 1.5, 2.2, color='#FFE0A6', light=110)
    room.put(f.filing_cabinet, (0, BACK - 0.45, 0), 4, 1.45, 0.6, 1.25, '#8A6238')
    room.put(f.globe, (-0.35, BACK - 0.45, 1.25), 0.22)
    room.put(p.book_stack, (0.35, BACK - 0.45, 1.25), ('green', 'manila', 'red'))
    room.wall(f.ladder, (-1.95, BACK - 1.15, 0), 3.9, 0.2)
    room.put(f.table, (2.7, 3.05, 0), 1.9, 0.9)
    room.put(p.open_book, (2.5, 2.95, 0.76))
    room.put(f.banker_lamp, (3.45, 3.1, 0.75))
    room.put(p.book_stack, (1.85, 3.2, 0.75), ('navy', 'teal'))
    room.put(f.side_chair, (2.7, 3.95, 0))
    room.put(f.armchair, (-3.3, 3.2, 0), 0.4, 'leather')
    room.put(f.rug, (0, 2.0, 0), (4.0, 2.0), 'green')
    room.wall(f.pendant_lamp, (0, RAFTERS[0], LAMP_Z), LAMP_DROP, 70, 'brass', 0.42)
    room.put(f.table, (-3.6, FRONT_Y, 0), 1.3, 0.7, 0.6, front=True)
    room.put(p.book_stack, (-3.9, FRONT_Y, 0.6), ('red', 'navy', 'green', 'manila'), front=True)
    room.put(p.book_stack, (-3.25, FRONT_Y, 0.6), ('teal', 'red'), front=True)
    return room


def staff():
    room = Room('staff')
    shell(room, '#73876F')
    room.wall(f.cork_board, (-1.0, BACK, 3.4), 4.6, 2.3)
    room.anchor('board', -1.0, 3.4, 4.6, 2.3, BACK - 0.09)
    room.wall(f.pigeonholes, (3.2, BACK, 3.5), 5, 4, 0.36)
    room.wall(f.wall_clock, (1.85, BACK, 4.55), 0.32)
    room.anchor('clock', 1.85, 4.55, 0.55, 0.55, BACK - 0.1)
    room.put(f.table, (3.2, 4.45, 0), 1.6, 0.6, 0.8)
    room.put(f.kettle, (2.7, 4.45, 0.8))
    for index, color in enumerate(('red', 'cream', 'navy')):
        room.put(f.mug, (3.3 + index * 0.28, 4.4 + 0.05 * index, 0.8), color)
    room.put(f.armchair, (-3.4, 3.5, 0), 0.4, 'green')
    room.put(f.armchair, (-1.5, 3.9, 0), -0.1, 'green')
    room.put(f.table, (-2.5, 2.75, 0), 0.9, 0.6, 0.45)
    room.put(f.mug, (-2.7, 2.75, 0.45))
    room.put(p.paper_sheet, (-2.3, 2.75, 0.455))
    room.put(f.plant, (4.35, 3.4, 0), 1.2)
    room.put(f.rug, (-0.6, 2.1, 0), (3.8, 1.8), 'navy')
    for x in (-2.4, 2.4):
        room.wall(f.pendant_lamp, (x, RAFTERS[0], LAMP_Z), LAMP_DROP, 60, 'cream', 0.42)
    room.put(f.table, (3.7, FRONT_Y, 0), 1.1, 0.7, 0.62, front=True)
    room.put(p.book_stack, (3.6, FRONT_Y, 0.62), ('red', 'manila', 'navy'), front=True)
    room.put(f.mug, (4.1, FRONT_Y - 0.1, 0.62), 'yellow', front=True)
    return room


def _tools(root, x, z):
    """A pegboard with a hammer, a saw, a spanner and three screwdrivers."""
    y = BACK - 0.02
    box('pegboard', (2.5, 0.04, 1.8), mat('ply'), root, (x, y, z), bevel=0.01)
    tube('hammer', [(x - 0.9, y - 0.06, z - 0.45), (x - 0.9, y - 0.06, z + 0.3)], 0.025, mat('oak_pale'), root)
    box('hammer_head', (0.34, 0.09, 0.11), mat('steel'), root, (x - 0.9, y - 0.06, z + 0.34), bevel=0.02)
    plate('saw', [(-0.42, 0.14), (0.42, 0.05), (0.42, -0.05), (-0.42, -0.14)], 0.01, mat('steel'), root, (x - 0.1, y - 0.05, z + 0.5))
    box('saw_grip', (0.22, 0.05, 0.34), mat('oak'), root, (x - 0.6, y - 0.06, z + 0.5), bevel=0.04)
    box('spanner', (0.08, 0.025, 0.7), mat('steel'), root, (x + 0.75, y - 0.05, z + 0.1), rot=(0, 0.3, 0), bevel=0.01)
    cone('spanner_ring', 0.09, 0.09, 0.03, mat('steel'), root, (x + 0.86, y - 0.05, z + 0.45), rot=(HALF_PI, 0, 0), sides=6)
    for k, color in enumerate(('red', 'yellow', 'blue')):
        sx = x - 0.4 + k * 0.28
        tube('driver', [(sx, y - 0.05, z - 0.6), (sx, y - 0.05, z - 0.25)], 0.012, mat('steel'), root)
        cone('driver_grip', 0.035, 0.03, 0.22, mat(color), root, (sx, y - 0.05, z - 0.14), sides=12)


def boiler(parent, loc):
    """A copper boiler with a fire door. It has its own root, so a room can scale it like furniture."""
    root = empty('boiler', parent, loc)
    copper = material('copper', '#B87333', rough=0.32, metal=1.0)
    cone('boiler_body', 0.58, 0.58, 2.1, copper, root, (0, 0, 1.35), sides=40)
    ball('boiler_dome', 0.58, copper, root, (0, 0, 2.4), scale=(1, 1, 0.55))
    for z in (0.5, 1.35, 2.2):
        cone('boiler_band', 0.6, 0.6, 0.07, mat('brass'), root, (0, 0, z), sides=40, bevel=0.01)
    for sx in (-1, 1):
        box('boiler_leg', (0.12, 0.12, 0.3), mat('iron'), root, (sx * 0.36, -0.2, 0.15), bevel=0.02)
    box('boiler_door', (0.42, 0.06, 0.3), mat('iron'), root, (0, -0.57, 0.85), bevel=0.03)
    box('boiler_fire', (0.3, 0.02, 0.07), material('fire_glow', '#FF8A2B', rough=0.4, emit=9.0), root, (0, -0.61, 0.85), bevel=0)
    point_light('boiler_light', root, (0, -0.9, 0.85), 30, (1.0, 0.5, 0.2))
    tube('boiler_flue', [(0, 0, 2.6), (0, 0, 3.4), (-0.35, 0, 3.75)], 0.1, copper, root)
    return root


def workshop():
    room = Room('workshop')
    shell(room, '#7C4F3F', 'stone', dado=None, backdrop=bricks('workshop_brick', '#8E5644', '#7A4638', '#B9AA94', 2.2))
    r = room.root
    copper = material('copper', '#B87333', rough=0.32, metal=1.0)
    panel = material('panel_steel', '#3B4047', rough=0.45, metal=0.6)
    box('panel', (4.1, 0.08, 2.0), panel, r, (0.5, BACK - 0.04, 3.1), bevel=0.03)
    for index in range(14):
        x, z = 0.5 + (index % 7 - 3) * 0.52, 3.5 - (index // 7) * 0.8
        cone('socket', 0.18, 0.18, 0.05, mat('iron'), r, (x, BACK - 0.1, z), rot=(HALF_PI, 0, 0), sides=28, bevel=0.01)
        cone('lens', 0.125, 0.125, 0.02, material('lens_dark', '#16231C', rough=0.2, coat=0.6), r, (x, BACK - 0.13, z),
             rot=(HALF_PI, 0, 0), sides=28, bevel=0)
        room.anchor(f'lamp{index}', x, z, 0.25, 0.25, BACK - 0.14)
    _tools(r, -3.1, 3.35)
    tube('pipe', [(-HALF, BACK - 0.2, 4.75), (2.9, BACK - 0.2, 4.75), (2.9, BACK - 0.2, 4.45), (HALF, BACK - 0.2, 4.45)], 0.07, copper, r)
    tube('pipe_low', [(-HALF, BACK - 0.16, 1.75), (-1.3, BACK - 0.16, 1.75), (-1.3, BACK - 0.16, 0.1)], 0.05, mat('steel'), r)
    cone('gauge_rim', 0.22, 0.22, 0.07, mat('brass'), r, (2.9, BACK - 0.3, 4.6), rot=(HALF_PI, 0, 0), sides=32, bevel=0.01)
    cone('gauge_face', 0.18, 0.18, 0.02, mat('cream'), r, (2.9, BACK - 0.34, 4.6), rot=(HALF_PI, 0, 0), sides=32, bevel=0)
    room.put(boiler, (3.95, 4.15, 0), s=1.2)
    room.wall(f.table, (-3.1, 4.25, 0), 3.0, 0.9, 1.25, 'oak_dark')
    box('toolbox', (0.9, 0.4, 0.4), mat('red'), r, (-3.8, 4.25, 1.45), bevel=0.03)
    tube('toolbox_grip', [(-4.1, 4.25, 1.65), (-4.1, 4.25, 1.78), (-3.5, 4.25, 1.78), (-3.5, 4.25, 1.65)], 0.02, mat('steel'), r)
    box('vice', (0.4, 0.4, 0.3), mat('iron'), r, (-2.1, 4.05, 1.4), bevel=0.03)
    cone('bucket', 0.24, 0.3, 0.46, mat('steel'), r, (1.75, 4.3, 0.23), sides=24)
    tube('mop', [(1.85, 4.35, 0.1), (2.2, 4.85, 2.7)], 0.028, mat('oak_pale'), r)
    room.wall(f.pendant_lamp, (0, RAFTERS[0], LAMP_Z), LAMP_DROP, 70, 'iron', 0.46)
    crate = box('crate', (1.2, 0.8, 0.8), mat('ply'), r, (-3.85, FRONT_Y - 0.1, 0.4), bevel=0.02)
    crate_top = box('crate_top', (0.8, 0.6, 0.5), mat('oak_pale'), r, (-3.95, FRONT_Y - 0.1, 1.05), bevel=0.02)
    room.front += [crate, crate_top]
    return room


def careers():
    room = Room('careers')
    shell(room, '#3B7377')
    r = room.root
    room.wall(f.cork_board, (-1.75, BACK, 3.4), 3.6, 2.1)
    room.anchor('board', -1.75, 3.4, 3.6, 2.1, BACK - 0.09)
    room.wall(f.pennant, (0.75, BACK, 4.3), color='yellow')
    room.wall(f.map_frame, (2.95, BACK, 3.6), 2.6, 1.6)
    box('counter', (4.2, 0.9, 1.35), mat('oak'), r, (2.5, 3.9, 0.675), bevel=0.02)
    box('counter_top', (4.4, 1.02, 0.08), mat('walnut'), r, (2.5, 3.9, 1.39), bevel=0.02)
    for k in range(3):
        box('counter_panel', (1.15, 0.03, 0.95), mat('oak_pale'), r, (1.2 + k * 1.3, 3.44, 0.68), bevel=0.015)
    cone('bell_base', 0.15, 0.15, 0.03, mat('walnut'), r, (1.0, 3.75, 1.445), sides=24, bevel=0.005)
    ball('bell', 0.12, mat('brass'), r, (1.0, 3.75, 1.47), scale=(1, 1, 0.7))
    room.put(f.banker_lamp, (3.9, 3.9, 1.02))
    room.put(p.book_stack, (2.5, 3.9, 1.02), ('manila', 'cream', 'manila'))
    box('rack', (1.3, 0.35, 2.3), mat('oak_dark'), r, (-4.0, 4.6, 1.15), bevel=0.02)
    for row in range(3):
        for col, color in enumerate(('red', 'yellow', 'teal')):
            box('leaflet', (0.3, 0.02, 0.46), mat(color if (row + col) % 2 else 'cream'), r,
                (-4.38 + col * 0.38, 4.4, 0.6 + row * 0.66), rot=(-0.25, 0, 0), bevel=0.004)
    for x in (-2.75, -1.85):
        room.put(f.side_chair, (x, 4.3, 0), s=1.25)
    room.put(f.plant, (4.4, 2.9, 0), 1.2)
    room.put(f.rug, (-0.4, 2.1, 0), (3.6, 1.8), 'teal')
    for x in (-2.4, 2.4):
        room.wall(f.pendant_lamp, (x, RAFTERS[0], LAMP_Z), LAMP_DROP, 60, 'yellow', 0.42)
    room.put(f.table, (-3.7, FRONT_Y, 0), 1.2, 0.7, 0.6, front=True)
    room.put(f.globe, (-3.7, FRONT_Y, 0.6), 0.26, front=True)
    return room


SETS = {'gate': gate, 'classroom': classroom, 'exam': exam, 'office': office, 'hall': hall,
        'library': library, 'staff': staff, 'workshop': workshop, 'careers': careers}
