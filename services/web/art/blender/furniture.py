"""Indoor furniture of the miniature school. Every builder makes one piece under
an empty at `loc` and returns that empty. A piece faces the camera (-Y); a floor
piece has its origin on the floor, a wall piece has its origin on the wall.
"""
import math

from kit import ball, box, cone, empty, material, plate, rounded_rect, tube
from mats import point_light
from props import mat

BOOK_COLORS = ('red', 'navy', 'green', 'teal', 'manila', 'blue', 'oak_pale', 'cream')
HALF_PI = math.pi / 2


def rand(seed):
    """A repeatable stream of numbers from 0 to 1, so a render is the same every time."""
    state = (seed * 9301 + 49297) % 233280
    while True:
        state = (state * 9301 + 49297) % 233280
        yield state / 233280


def glow(color, strength):
    return material(f'glow_{color}_{strength}', color, rough=0.4, emit=strength)


def book_row(root, x0, x1, z, height, depth, seed):
    """Books standing on a shelf from x0 to x1."""
    numbers = rand(seed)
    x = x0
    while x < x1 - 0.06:
        width = 0.05 + 0.06 * next(numbers)
        tall = height * (0.62 + 0.3 * next(numbers))
        color = BOOK_COLORS[int(next(numbers) * len(BOOK_COLORS))]
        if next(numbers) < 0.1:
            x += 0.1
            continue
        if x + width > x1:
            break
        box('shelf_book', (width - 0.006, depth, tall), mat(color), root, (x + width / 2, -0.02, z + tall / 2), bevel=0.006)
        x += width


def bookshelf(parent, loc, width=1.6, height=2.6, shelves=4, depth=0.42, seed=1, wood='oak_dark'):
    root = empty('bookshelf', parent, loc)
    side = 0.06
    for sx in (-1, 1):
        box('shelf_side', (side, depth, height), mat(wood), root, (sx * (width - side) / 2, 0, height / 2), bevel=0.012)
    box('shelf_back', (width, 0.03, height), mat('walnut'), root, (0, depth / 2 - 0.015, height / 2), bevel=0)
    box('shelf_crown', (width + 0.1, depth + 0.06, 0.09), mat(wood), root, (0, 0, height + 0.02), bevel=0.02)
    bay = (height - 0.12) / shelves
    for row in range(shelves):
        z = 0.1 + row * bay
        box('shelf_board', (width - side, depth - 0.02, 0.045), mat(wood), root, (0, 0, z - 0.022), bevel=0.008)
        book_row(root, -width / 2 + side + 0.02, width / 2 - side - 0.02, z, bay - 0.1, depth * 0.62, seed * 31 + row)
    return root


def chalkboard(parent, loc, width=4.6, height=2.0):
    root = empty('chalkboard', parent, loc)
    box('board_frame', (width + 0.18, 0.07, height + 0.18), mat('oak'), root, (0, -0.035, 0), bevel=0.02)
    box('board_slate', (width, 0.02, height), mat('slate'), root, (0, -0.075, 0), bevel=0)
    box('board_tray', (width * 0.92, 0.12, 0.04), mat('oak_dark'), root, (0, -0.11, -height / 2 - 0.07), bevel=0.01)
    for index, color in enumerate(('chalk', 'yellow', 'pink')):
        cone('chalk_stick', 0.016, 0.016, 0.12, mat(color), root, (-width * 0.3 + index * 0.17, -0.12, -height / 2 - 0.035),
             rot=(0, HALF_PI, 0.2 * index), sides=10, bevel=0)
    box('board_eraser', (0.22, 0.08, 0.05), mat('oak_pale'), root, (width * 0.3, -0.12, -height / 2 - 0.025), bevel=0.01)
    box('board_felt', (0.22, 0.08, 0.02), mat('ink'), root, (width * 0.3, -0.12, -height / 2 - 0.045), bevel=0.004)
    return root


def pin(root, x, z, y=-0.08, color='red'):
    ball('pin_head', 0.028, mat(color), root, (x, y - 0.02, z))


def cork_board(parent, loc, width=3.4, height=1.9, notes=()):
    """`notes` are (x, z, width, height, colour, turn) papers pinned to the cork."""
    root = empty('cork_board', parent, loc)
    box('cork_frame', (width + 0.16, 0.07, height + 0.16), mat('oak_dark'), root, (0, -0.035, 0), bevel=0.02)
    box('cork_face', (width, 0.02, height), mat('cork'), root, (0, -0.075, 0), bevel=0)
    for x, z, w, h, color, turn in notes:
        plate('cork_note', rounded_rect(w, h, 0.012), 0.006, mat(color), root, (x, -0.094, z), rot=(0, turn, 0))
        pin(root, x, z + h / 2 - 0.05, -0.095, 'red' if color != 'red' else 'navy')
    return root


def window(parent, loc, width=1.5, height=2.0, color='#FFD08A', strength=2.6, curtains=None, light=90):
    root = empty('window', parent, loc)
    frame = 0.09
    box('window_pane', (width, 0.02, height), glow(color, strength), root, (0, -0.01, 0), bevel=0)
    for sx in (-1, 1):
        box('window_jamb', (frame, 0.1, height + frame * 2), mat('oak_pale'), root, (sx * (width + frame) / 2, -0.05, 0), bevel=0.015)
    for sz in (-1, 1):
        box('window_head', (width, 0.1, frame), mat('oak_pale'), root, (0, -0.05, sz * (height + frame) / 2), bevel=0.015)
    box('window_mullion', (0.05, 0.07, height), mat('oak_pale'), root, (0, -0.045, 0), bevel=0.008)
    for z in (-height / 6, height / 6):
        box('window_bar', (width, 0.07, 0.045), mat('oak_pale'), root, (0, -0.045, z), bevel=0.008)
    box('window_sill', (width + 0.36, 0.22, 0.06), mat('oak'), root, (0, -0.11, -height / 2 - frame - 0.02), bevel=0.015)
    if curtains:
        for sx in (-1, 1):
            curtain(root, (sx * (width / 2 + 0.2), -0.16, -height / 2 - 0.3), 0.5, height + 0.75, 4, curtains)
        tube('curtain_rod', [(-width / 2 - 0.55, -0.16, height / 2 + 0.36), (width / 2 + 0.55, -0.16, height / 2 + 0.36)], 0.025,
             mat('brass'), root)
    if light:
        point_light('window_light', root, (0, -0.7, 0), light, (1.0, 0.78, 0.5), 0.5)
    return root


def curtain(parent, loc, width, height, folds=5, color='red'):
    """A hanging cloth in folds. Its origin is the centre of the hem."""
    root = empty('curtain', parent, loc)
    radius = width / folds / 1.5
    for k in range(folds):
        x = -width / 2 + width * (k + 0.5) / folds
        cone('curtain_fold', radius * 1.25, radius, height, mat(color), root, (x, 0.04 * (k % 2), height / 2), sides=14, bevel=0)
    return root


def wall_clock(parent, loc, radius=0.38):
    """A clock without hands: the page draws the real time on its face."""
    root = empty('clock', parent, loc)
    cone('clock_rim', radius, radius, 0.09, mat('oak_dark'), root, (0, -0.045, 0), rot=(HALF_PI, 0, 0), sides=48, bevel=0.015)
    cone('clock_face', radius * 0.86, radius * 0.86, 0.02, mat('cream'), root, (0, -0.09, 0), rot=(HALF_PI, 0, 0), sides=48, bevel=0)
    for hour in range(12):
        angle = hour * math.pi / 6
        long_tick = hour % 3 == 0
        box('clock_tick', (0.02 if long_tick else 0.012, 0.004, 0.07 if long_tick else 0.04), mat('ink'), root,
            (math.sin(angle) * radius * 0.7, -0.102, math.cos(angle) * radius * 0.7), rot=(0, angle, 0), bevel=0)
    return root


def pendant_lamp(parent, loc, drop=0.9, power=110, shade='green', radius=0.34):
    """A ceiling lamp. Its origin is the point where the cord meets the ceiling."""
    root = empty('pendant', parent, loc)
    tube('pendant_cord', [(0, 0, 0), (0, 0, -drop)], 0.012, mat('ink'), root)
    cone('pendant_cap', 0.05, 0.03, 0.08, mat('brass'), root, (0, 0, -drop + 0.02), bevel=0.006)
    cone('pendant_shade', radius, 0.07, 0.24, mat(shade), root, (0, 0, -drop - 0.12), sides=40, bevel=0.01)
    ball('pendant_bulb', 0.075, glow('#FFD9A0', 14.0), root, (0, 0, -drop - 0.2))
    if power:
        point_light('pendant_light', root, (0, 0, -drop - 0.32), power)
    return root


def banker_lamp(parent, loc, power=22):
    root = empty('banker_lamp', parent, loc)
    box('lamp_base', (0.26, 0.15, 0.03), mat('brass'), root, (0, 0, 0.015), bevel=0.01)
    tube('lamp_stem', [(0, 0.03, 0.03), (0, 0.04, 0.2), (0, 0.0, 0.31)], 0.016, mat('brass'), root)
    green = material('lamp_green_glass', '#1F7A52', rough=0.15, coat=0.6, emit=0.35)
    box('lamp_shade', (0.36, 0.15, 0.09), green, root, (0, -0.01, 0.335), bevel=0.04, segments=5)
    box('lamp_glow', (0.28, 0.09, 0.01), glow('#FFE2A8', 9.0), root, (0, -0.01, 0.288), bevel=0)
    if power:
        point_light('lamp_light', root, (0, -0.06, 0.22), power, radius=0.05)
    return root


def plant(parent, loc, scale=1.0, leaves=9, pot='terracotta'):
    root = empty('plant', parent, loc)
    root.scale = (scale, scale, scale)
    cone('plant_pot', 0.13, 0.19, 0.28, mat(pot), root, (0, 0, 0.14), sides=28, bevel=0.012)
    cone('plant_rim', 0.2, 0.2, 0.05, mat(pot), root, (0, 0, 0.27), sides=28, bevel=0.012)
    for k in range(leaves):
        angle = k * 2.4
        tilt = 0.45 + 0.12 * (k % 3)
        reach = 0.1 + 0.02 * (k % 4)
        ball('plant_leaf', 0.24, mat('leaf'), root, (reach * math.sin(angle), -reach * math.cos(angle), 0.46 + 0.045 * k),
             scale=(0.4, 0.1, 1.0), rot=(tilt, 0, angle))
    return root


def filing_cabinet(parent, loc, drawers=4, width=0.72, depth=0.62, height=1.5, color='#6E7F78'):
    root = empty('cabinet', parent, loc)
    body = material(f'cabinet_{color}', color, rough=0.45, metal=0.3)
    box('cabinet_body', (width, depth, height), body, root, (0, 0, height / 2), bevel=0.02)
    row = (height - 0.08) / drawers
    for k in range(drawers):
        z = 0.04 + row * (k + 0.5)
        box('cabinet_drawer', (width - 0.08, 0.03, row - 0.05), body, root, (0, -depth / 2 - 0.01, z), bevel=0.012)
        box('cabinet_pull', (0.2, 0.03, 0.03), mat('steel'), root, (0, -depth / 2 - 0.04, z - row * 0.18), bevel=0.01)
        box('cabinet_label', (0.16, 0.006, 0.07), mat('paper'), root, (0, -depth / 2 - 0.028, z + row * 0.15), bevel=0)
    return root


def globe(parent, loc, radius=0.2):
    root = empty('globe', parent, loc)
    cone('globe_foot', 0.12, 0.08, 0.04, mat('walnut'), root, (0, 0, 0.02), bevel=0.008)
    tube('globe_post', [(0, 0, 0.04), (0, 0, 0.1)], 0.015, mat('brass'), root)
    arc = [(radius * 1.12 * math.cos(math.radians(a)), 0, 0.12 + radius + radius * 1.12 * math.sin(math.radians(a))) for a in range(-90, 100, 15)]
    tube('globe_arc', arc, 0.012, mat('brass'), root)
    ball('globe_sea', radius, mat('blue'), root, (0, 0, 0.12 + radius), rot=(0, 0.4, 0))
    numbers = rand(7)
    for _ in range(7):
        a, b = next(numbers) * 6.28, (next(numbers) - 0.5) * 1.8
        point = (math.cos(a) * math.cos(b) * radius * 0.94, math.sin(a) * math.cos(b) * radius * 0.94, 0.12 + radius + math.sin(b) * radius * 0.94)
        ball('globe_land', radius * (0.2 + 0.2 * next(numbers)), mat('leaf'), root, point)
    return root


def pennant(parent, loc, width=0.62, height=1.15, color='navy'):
    root = empty('pennant', parent, loc)
    outline = [(-width / 2, height / 2), (width / 2, height / 2), (width / 2, -height / 2 + 0.22), (0, -height / 2), (-width / 2, -height / 2 + 0.22)]
    plate('pennant_cloth', outline, 0.012, mat(color), root, (0, -0.03, 0))
    tube('pennant_rod', [(-width / 2 - 0.06, -0.035, height / 2), (width / 2 + 0.06, -0.035, height / 2)], 0.018, mat('brass'), root)
    cone('pennant_ring', 0.17, 0.17, 0.008, mat('gold'), root, (0, -0.034, 0.1), rot=(HALF_PI, 0, 0), sides=32, bevel=0)
    cone('pennant_disc', 0.13, 0.13, 0.01, mat(color), root, (0, -0.036, 0.1), rot=(HALF_PI, 0, 0), sides=32, bevel=0)
    for sx in (-1, 1):
        box('pennant_page', (0.085, 0.006, 0.11), mat('gold'), root, (sx * 0.048, -0.042, 0.1), rot=(0, sx * 0.14, 0), bevel=0)
    return root


def office_desk(parent, loc, width=2.6, depth=1.0, height=0.82):
    root = empty('office_desk', parent, loc)
    box('odesk_top', (width, depth, 0.07), mat('walnut'), root, (0, 0, height - 0.035), bevel=0.02)
    pedestal = 0.72
    for sx in (-1, 1):
        x = sx * (width / 2 - pedestal / 2 - 0.05)
        box('odesk_pedestal', (pedestal, depth - 0.12, height - 0.07), mat('oak_dark'), root, (x, 0, (height - 0.07) / 2), bevel=0.015)
        for k in range(3):
            z = 0.14 + k * 0.22
            box('odesk_drawer', (pedestal - 0.1, 0.03, 0.18), mat('oak'), root, (x, -depth / 2 + 0.05, z), bevel=0.012)
            ball('odesk_knob', 0.025, mat('brass'), root, (x, -depth / 2 + 0.02, z))
    box('odesk_panel', (width - pedestal * 2 - 0.1, 0.04, 0.5), mat('oak'), root, (0, depth / 2 - 0.12, height - 0.33), bevel=0.012)
    return root


def armchair(parent, loc, facing=0.0, color='leather'):
    root = empty('armchair', parent, loc)
    root.rotation_euler = (0, 0, facing)
    box('arm_seat', (0.92, 0.82, 0.3), mat(color), root, (0, 0, 0.33), bevel=0.1, segments=5)
    box('arm_cushion', (0.6, 0.6, 0.14), mat(color), root, (0, -0.06, 0.52), bevel=0.06, segments=5)
    box('arm_back', (0.92, 0.26, 0.8), mat(color), root, (0, 0.33, 0.72), bevel=0.12, segments=5)
    for sx in (-1, 1):
        box('arm_rest', (0.22, 0.82, 0.46), mat(color), root, (sx * 0.42, 0, 0.5), bevel=0.1, segments=5)
        for sy in (-1, 1):
            cone('arm_foot', 0.03, 0.045, 0.16, mat('walnut'), root, (sx * 0.36, sy * 0.3, 0.08), sides=12, bevel=0.006)
    for row in range(2):
        for col in (-1, 0, 1):
            ball('arm_button', 0.022, mat('walnut'), root, (col * 0.22, 0.19, 0.74 + row * 0.22))
    return root


def rug(parent, loc, size=(4.0, 2.4), color='red', border='cream'):
    root = empty('rug', parent, loc)
    box('rug_border', (size[0], size[1], 0.02), mat(border), root, (0, 0, 0.01), bevel=0.008)
    box('rug_field', (size[0] - 0.3, size[1] - 0.3, 0.024), mat(color), root, (0, 0, 0.013), bevel=0.006)
    box('rug_inner', (size[0] - 0.9, size[1] - 0.9, 0.027), mat(border), root, (0, 0, 0.014), bevel=0.004)
    box('rug_core', (size[0] - 1.0, size[1] - 1.0, 0.03), mat(color), root, (0, 0, 0.015), bevel=0.004)
    return root


def trophy(parent, loc, scale=1.0):
    root = empty('trophy', parent, loc)
    root.scale = (scale, scale, scale)
    box('trophy_base', (0.2, 0.2, 0.08), mat('walnut'), root, (0, 0, 0.04), bevel=0.012)
    cone('trophy_stem', 0.05, 0.025, 0.14, mat('gold'), root, (0, 0, 0.15), sides=20, bevel=0.006)
    cone('trophy_cup', 0.04, 0.13, 0.22, mat('gold'), root, (0, 0, 0.33), sides=32, bevel=0.01)
    for sx in (-1, 1):
        arc = [(sx * (0.11 + 0.07 * math.sin(math.radians(a))), 0, 0.33 + 0.08 * math.cos(math.radians(a))) for a in range(0, 181, 30)]
        tube('trophy_handle', arc, 0.012, mat('gold'), root)
    return root


def ladder(parent, loc, height=3.6, lean=0.2, width=0.52):
    root = empty('ladder', parent, loc)
    root.rotation_euler = (-lean, 0, 0)
    for sx in (-1, 1):
        box('ladder_rail', (0.055, 0.05, height), mat('oak_pale'), root, (sx * width / 2, 0, height / 2), bevel=0.01)
    for k in range(int(height / 0.36)):
        box('ladder_rung', (width, 0.04, 0.04), mat('oak_pale'), root, (0, 0, 0.3 + k * 0.36), bevel=0.01)
    return root


def table(parent, loc, width=1.8, depth=0.9, height=0.75, wood='oak'):
    root = empty('table', parent, loc)
    box('table_top', (width, depth, 0.06), mat(wood), root, (0, 0, height - 0.03), bevel=0.018)
    box('table_apron', (width - 0.16, depth - 0.16, 0.1), mat('oak_dark'), root, (0, 0, height - 0.11), bevel=0.008)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box('table_leg', (0.07, 0.07, height - 0.06), mat('oak_dark'), root,
                (sx * (width / 2 - 0.08), sy * (depth / 2 - 0.08), (height - 0.06) / 2), bevel=0.012)
    return root


def pigeonholes(parent, loc, cols=5, rows=4, cell=0.32, depth=0.3, seed=3):
    """Wall-mounted mail slots for the staff. The origin is the centre of the back."""
    root = empty('pigeonholes', parent, loc)
    width, height = cols * cell, rows * cell
    box('holes_back', (width, 0.02, height), mat('walnut'), root, (0, -0.01, 0), bevel=0)
    for col in range(cols + 1):
        box('holes_wall', (0.025, depth, height + 0.025), mat('oak_pale'), root, (-width / 2 + col * cell, -depth / 2, 0), bevel=0.004)
    for row in range(rows + 1):
        box('holes_floor', (width + 0.025, depth, 0.025), mat('oak_pale'), root, (0, -depth / 2, -height / 2 + row * cell), bevel=0.004)
    numbers = rand(seed)
    for col in range(cols):
        for row in range(rows):
            if next(numbers) < 0.55:
                color = ('paper', 'manila', 'cream')[int(next(numbers) * 3)]
                box('holes_mail', (cell * 0.7, depth * 0.8, 0.02 + 0.05 * next(numbers)), mat(color), root,
                    (-width / 2 + (col + 0.5) * cell, -depth / 2 - 0.02, -height / 2 + row * cell + 0.045), bevel=0.004)
    return root


def mug(parent, loc, color='cream'):
    root = empty('mug', parent, loc)
    cone('mug_body', 0.04, 0.046, 0.09, mat(color), root, (0, 0, 0.045), sides=20, bevel=0.006)
    arc = [(0.045 + 0.03 * math.sin(math.radians(a)), 0, 0.045 + 0.03 * math.cos(math.radians(a))) for a in range(0, 181, 36)]
    tube('mug_handle', arc, 0.008, mat(color), root)
    return root


def kettle(parent, loc):
    root = empty('kettle', parent, loc)
    ball('kettle_body', 0.12, mat('steel'), root, (0, 0, 0.1), scale=(1, 1, 0.82))
    cone('kettle_lid', 0.05, 0.02, 0.03, mat('ink'), root, (0, 0, 0.205), bevel=0.006)
    tube('kettle_spout', [(0.09, 0, 0.1), (0.17, 0, 0.17)], 0.018, mat('steel'), root)
    arc = [(-0.02 + 0.1 * math.cos(math.radians(a)), 0, 0.2 + 0.07 * math.sin(math.radians(a))) for a in range(20, 161, 28)]
    tube('kettle_handle', arc, 0.012, mat('ink'), root)
    return root


def pencil_pot(parent, loc, scale=1.0):
    root = empty('pencil_pot', parent, loc)
    root.scale = (scale, scale, scale)
    cone('pot_body', 0.06, 0.065, 0.13, mat('navy'), root, (0, 0, 0.065), sides=24, bevel=0.008)
    for k, color in enumerate(('yellow', 'red', 'blue', 'yellow', 'green')):
        angle = k * 1.3
        cone('pot_pencil', 0.011, 0.011, 0.2, mat(color), root, (0.025 * math.cos(angle), 0.025 * math.sin(angle), 0.17),
             rot=(0.14 * math.sin(angle), 0.14 * math.cos(angle), 0), sides=6, bevel=0)
        cone('pot_tip', 0.011, 0.0, 0.035, mat('oak_pale'), root,
             (0.025 * math.cos(angle) + 0.028 * math.cos(angle) * 0.5, 0.025 * math.sin(angle) - 0.028 * math.sin(angle) * 0.5, 0.285),
             rot=(0.14 * math.sin(angle), 0.14 * math.cos(angle), 0), sides=6, bevel=0)
    return root


def map_frame(parent, loc, width=1.8, height=1.2):
    root = empty('map', parent, loc)
    box('map_frame', (width + 0.12, 0.05, height + 0.12), mat('oak_dark'), root, (0, -0.025, 0), bevel=0.015)
    box('map_sea', (width, 0.02, height), material('map_sea', '#9DBFCB', rough=0.8), root, (0, -0.055, 0), bevel=0)
    lands = [(-0.55, 0.18, 0.42, 0.4), (-0.42, -0.25, 0.2, 0.36), (0.02, 0.22, 0.3, 0.3), (0.08, -0.14, 0.24, 0.4),
             (0.48, 0.2, 0.5, 0.36), (0.62, -0.32, 0.22, 0.16)]
    for x, z, w, h in lands:
        plate('map_land', rounded_rect(w * width / 1.8, h * height / 1.2, min(w, h) * 0.3), 0.006, mat('manila'), root,
              (x * width / 1.8, -0.068, z * height / 1.2))
    return root


def side_chair(parent, loc, facing=0.0):
    """A plain wooden chair seen from the back when `facing` is pi."""
    root = empty('side_chair', parent, loc)
    root.rotation_euler = (0, 0, facing)
    box('schair_seat', (0.5, 0.46, 0.05), mat('oak'), root, (0, 0, 0.42), bevel=0.015)
    box('schair_rail', (0.5, 0.05, 0.12), mat('oak'), root, (0, 0.215, 0.98), bevel=0.02)
    box('schair_slat', (0.34, 0.03, 0.4), mat('oak_pale'), root, (0, 0.215, 0.7), bevel=0.01)
    for sx in (-1, 1):
        box('schair_post', (0.05, 0.05, 1.04), mat('oak_dark'), root, (sx * 0.215, 0.215, 0.52), bevel=0.01)
        box('schair_leg', (0.05, 0.05, 0.4), mat('oak_dark'), root, (sx * 0.215, -0.19, 0.2), bevel=0.01)
    return root
