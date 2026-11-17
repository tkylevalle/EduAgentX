"""The prop library of the miniature school. Each builder makes one prop under
an empty at `loc` and returns that empty, so a room is a list of placements
and Quill's hand props come from the same shelf.
"""
import math

from kit import ball, box, cone, empty, material, plate, rounded_rect, text, tube
from mats import grain

PALETTE = {
    'oak': ('#A8733F', 0.55), 'oak_dark': ('#7A4F28', 0.6), 'oak_pale': ('#C99A5E', 0.55),
    'paper': ('#F3EAD3', 0.85), 'manila': ('#E3C88F', 0.8), 'ink': ('#2B2A2E', 0.6),
    'red': ('#C8352B', 0.5), 'navy': ('#1F2C4D', 0.6), 'green': ('#2F5D50', 0.75),
    'gold': ('#D9A62B', 0.3), 'steel': ('#9AA0A8', 0.35), 'chalk': ('#EDE8DA', 0.9),
    'brass': ('#C9993F', 0.38), 'iron': ('#2A2B30', 0.5), 'pink': ('#EE8B94', 0.8), 'yellow': ('#FDAE12', 0.4),
    'cork': ('#B98A56', 0.95), 'blue': ('#3C6FB0', 0.6), 'teal': ('#2E7F86', 0.6),
    'plaster': ('#D8C7A9', 0.9), 'brick': ('#9C5A43', 0.9), 'leaf': ('#4E8B4A', 0.6),
    'terracotta': ('#B8663F', 0.8), 'cream': ('#F0E4C8', 0.6), 'black': ('#17161A', 0.5),
}
METALS = {'gold', 'steel', 'brass', 'iron'}


# Two-tone noise materials: (light, dark, noise scale, roughness, coat, bump).
GRAINS = {
    'oak': ('#B98349', '#96622F', (9, 0.7, 9), 0.5, 0.25, 0.1),
    'oak_dark': ('#87592E', '#684220', (9, 0.7, 9), 0.55, 0.25, 0.1),
    'oak_pale': ('#D5A76A', '#BD8C52', (9, 0.7, 9), 0.5, 0.2, 0.1),
    'walnut': ('#5A3A26', '#3E2617', (8, 0.6, 8), 0.5, 0.3, 0.1),
    'ply': ('#DDBD8C', '#C9A572', (2.5, 14, 2.5), 0.7, 0.0, 0.05),
    'cork': ('#C4935C', '#A87643', (60, 60, 60), 0.95, 0.0, 0.5),
    'slate': ('#2F5D50', '#274E43', (1.6, 1.6, 1.6), 0.85, 0.0, 0.03),
    'leather': ('#7A3B2A', '#63301F', (30, 30, 30), 0.45, 0.2, 0.25),
    'stone': ('#9B958A', '#857F74', (5, 5, 5), 0.9, 0.0, 0.3),
    'roof': ('#56606B', '#434B55', (6, 6, 6), 0.8, 0.0, 0.3),
}


def mat(key):
    if key in GRAINS:
        light, dark, scale, rough, coat, bump = GRAINS[key]
        return grain(f'prop_{key}', light, dark, scale, rough, coat, bump)
    color, rough = PALETTE[key]
    return material(f'prop_{key}', color, rough=rough, metal=1.0 if key in METALS else 0.0)


def paint(color, rough=0.9):
    """Wall paint: a flat colour with a little plaster mottle."""
    return grain(f'paint_{color}', color, color, (3, 3, 3), rough, 0.0, 0.08)


def glow(key, color, strength):
    return material(f'glow_{key}', color, rough=0.4, emit=strength)


def desk(parent=None, loc=(0, 0, 0), width=1.3, depth=0.7, height=0.66, collection=None):
    """A school desk. The top surface is at `height`; the front panel faces the camera."""
    root = empty('desk', parent, loc, collection)
    top = 0.06
    box('desk_top', (width, depth, top), mat('oak'), root, (0, 0, height - top / 2), bevel=0.018, collection=collection)
    leg = height - top
    for sx in (-1, 1):
        for sy in (-1, 1):
            box('desk_leg', (0.07, 0.07, leg), mat('oak_dark'), root,
                (sx * (width / 2 - 0.07), sy * (depth / 2 - 0.07), leg / 2), bevel=0.012, collection=collection)
    box('desk_panel', (width - 0.14, 0.03, 0.3), mat('oak_pale'), root, (0, -depth / 2 + 0.07, height - top - 0.16),
        bevel=0.008, collection=collection)
    box('desk_shelf', (width - 0.14, depth - 0.2, 0.025), mat('oak_dark'), root, (0, 0, height - 0.2), bevel=0.006,
        collection=collection)
    return root


def chair(parent=None, loc=(0, 0, 0), collection=None, facing=0.0):
    root = empty('chair', parent, loc, collection)
    root.rotation_euler = (0, 0, facing)
    box('chair_seat', (0.5, 0.46, 0.05), mat('oak'), root, (0, 0, 0.36), bevel=0.015, collection=collection)
    box('chair_back', (0.5, 0.05, 0.34), mat('oak'), root, (0, 0.215, 0.8), bevel=0.02, collection=collection)
    for sx in (-1, 1):
        box('chair_post', (0.05, 0.05, 0.98), mat('oak_dark'), root, (sx * 0.215, 0.215, 0.49), bevel=0.01, collection=collection)
        box('chair_leg', (0.05, 0.05, 0.35), mat('oak_dark'), root, (sx * 0.215, -0.19, 0.175), bevel=0.01, collection=collection)
    return root


def book(parent=None, loc=(0, 0, 0), size=(0.3, 0.22, 0.05), cover='red', rot=(0, 0, 0), collection=None):
    """A closed book lying flat, spine along X."""
    root = empty('book', parent, loc, collection)
    root.rotation_euler = rot
    width, depth, thick = size
    box('book_cover', (width, depth, thick), mat(cover), root, (0, 0, thick / 2), bevel=0.006, collection=collection)
    box('book_pages', (width - 0.012, depth - 0.008, thick - 0.016), mat('paper'), root, (0.008, -0.008, thick / 2),
        bevel=0.002, collection=collection)
    return root


def book_stack(parent=None, loc=(0, 0, 0), covers=('navy', 'red', 'green'), collection=None, spin=0.2):
    root = empty('book_stack', parent, loc, collection)
    height = 0.0
    for index, cover in enumerate(covers):
        thick = 0.05 + 0.012 * ((index * 7) % 3)
        book(root, (0.015 * ((index % 2) * 2 - 1), 0, height), (0.32 - 0.02 * index, 0.23, thick), cover,
             (0, 0, spin * ((index % 3) - 1)), collection)
        height += thick
    return root


def open_book(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), cover='navy', scale=1.0, collection=None):
    """An open book whose pages face up. Tilt it with `rot` to hold it towards the reader."""
    root = empty('open_book', parent, loc, collection)
    root.rotation_euler = rot
    root.scale = (scale, scale, scale)
    for sx in (-1, 1):
        box('open_cover', (0.3, 0.4, 0.016), mat(cover), root, (sx * 0.148, 0, 0.012), rot=(0, -sx * 0.12, 0),
            bevel=0.005, collection=collection)
        box('open_pages', (0.28, 0.37, 0.03), mat('paper'), root, (sx * 0.142, 0, 0.034), rot=(0, -sx * 0.16, 0),
            bevel=0.008, collection=collection)
        for row in range(5):
            box('open_line', (0.2, 0.012, 0.003), mat('ink'), root, (sx * 0.145, 0.12 - row * 0.055, 0.055 - 0.004 * abs(sx)),
                rot=(0, -sx * 0.16, 0), bevel=0, collection=collection)
    return root


def paper_sheet(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), lines=5, collection=None):
    root = empty('paper', parent, loc, collection)
    root.rotation_euler = rot
    box('sheet', (0.34, 0.44, 0.006), mat('paper'), root, (0, 0, 0.003), bevel=0, collection=collection)
    for row in range(lines):
        box('sheet_line', (0.24 - 0.05 * (row % 2), 0.014, 0.003), mat('ink'), root, (-0.02 + 0.025 * (row % 2), 0.14 - row * 0.06, 0.007),
            bevel=0, collection=collection)
    return root


def pencil(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), length=0.36, collection=None):
    """A yellow pencil along Z with the point down."""
    root = empty('pencil', parent, loc, collection)
    root.rotation_euler = rot
    yellow = material('pencil_yellow', '#F6B81A', rough=0.35, coat=0.3)
    cone('pencil_shaft', 0.026, 0.026, length, yellow, root, (0, 0, length / 2 + 0.07), sides=6, bevel=0.004, collection=collection)
    cone('pencil_wood', 0.006, 0.026, 0.06, mat('oak_pale'), root, (0, 0, 0.04), sides=12, bevel=0, collection=collection)
    cone('pencil_lead', 0.0, 0.008, 0.02, mat('ink'), root, (0, 0, 0.008), sides=12, bevel=0, collection=collection)
    cone('pencil_band', 0.028, 0.028, 0.035, mat('steel'), root, (0, 0, length + 0.085), sides=16, bevel=0.003, collection=collection)
    cone('pencil_rubber', 0.026, 0.026, 0.04, material('pencil_pink', '#EE8B94', rough=0.8), root, (0, 0, length + 0.12),
         sides=16, bevel=0.008, collection=collection)
    return root


def report_card(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), stamp='red', collection=None):
    """An upright report card that faces the camera. Its origin is the bottom edge."""
    root = empty('report_card', parent, loc, collection)
    root.rotation_euler = rot
    plate('card_sheet', rounded_rect(0.4, 0.52, 0.02), 0.012, mat('paper'), root, (0, 0, 0.26), collection=collection)
    box('card_head', (0.26, 0.004, 0.04), mat('ink'), root, (-0.04, -0.002, 0.45), bevel=0, collection=collection)
    for row in range(4):
        box('card_line', (0.3 - 0.06 * (row % 2), 0.004, 0.016), mat('ink'), root, (-0.02 - 0.03 * (row % 2), -0.002, 0.37 - row * 0.055),
            bevel=0, collection=collection)
    if stamp:
        cone('card_stamp', 0.07, 0.07, 0.006, mat(stamp), root, (0.09, -0.004, 0.11), rot=(math.pi / 2, 0, 0), sides=32, bevel=0,
             collection=collection)
        cone('card_stamp_in', 0.052, 0.052, 0.008, mat('paper'), root, (0.09, -0.005, 0.11), rot=(math.pi / 2, 0, 0), sides=32,
             bevel=0, collection=collection)
        box('card_stamp_bar', (0.085, 0.01, 0.022), mat(stamp), root, (0.09, -0.006, 0.11), rot=(0, 0.3, 0), bevel=0,
            collection=collection)
    return root


def diploma(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), hold=False, collection=None):
    """A flat diploma that faces the camera, origin at its centre. `hold` adds the suspension band."""
    root = empty('diploma', parent, loc, collection)
    root.rotation_euler = rot
    plate('diploma_frame', rounded_rect(0.66, 0.48, 0.02), 0.012, mat('gold'), root, (0, 0.004, 0), collection=collection)
    plate('diploma_sheet', rounded_rect(0.6, 0.42, 0.012), 0.012, mat('paper'), root, (0, -0.004, 0), collection=collection)
    box('diploma_title', (0.34, 0.004, 0.045), mat('navy'), root, (0, -0.006, 0.12), bevel=0, collection=collection)
    for row in range(3):
        box('diploma_line', (0.42 - 0.1 * row, 0.004, 0.014), mat('ink'), root, (0, -0.006, 0.04 - row * 0.045), bevel=0,
            collection=collection)
    cone('diploma_seal', 0.06, 0.06, 0.02, mat('red'), root, (0.19, -0.016, -0.12), rot=(math.pi / 2, 0, 0), sides=14, bevel=0.006,
         collection=collection)
    for sx in (-1, 1):
        box('diploma_ribbon', (0.035, 0.006, 0.11), mat('red'), root, (0.19 + sx * 0.025, -0.008, -0.2), rot=(0, sx * 0.25, 0),
            bevel=0, collection=collection)
    if hold:
        box('diploma_hold', (0.74, 0.01, 0.1), mat('red'), root, (0, -0.02, 0.0), rot=(0, -0.28, 0), bevel=0.004, collection=collection)
        text('diploma_hold_text', 'ON HOLD', 0.075, mat('paper'), root, (0, -0.028, 0.0), extrude=0.002,
             rot=(math.pi / 2, -0.28, 0), collection=collection)
    return root


def scroll(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), collection=None):
    """A rolled diploma along Z, tied with a red ribbon. Its origin is where the hand grips it."""
    root = empty('scroll', parent, loc, collection)
    root.rotation_euler = rot
    cone('scroll_roll', 0.05, 0.05, 0.5, mat('paper'), root, (0, 0, 0.12), sides=24, bevel=0.006, collection=collection)
    for end in (-0.13, 0.37):
        cone('scroll_core', 0.03, 0.03, 0.004, mat('manila'), root, (0, 0, end), sides=16, bevel=0, collection=collection)
    cone('scroll_band', 0.056, 0.056, 0.06, mat('red'), root, (0, 0, 0.12), sides=24, bevel=0.004, collection=collection)
    for sx in (-1, 1):
        box('scroll_tail', (0.03, 0.006, 0.1), mat('red'), root, (sx * 0.02, -0.056, 0.06), rot=(0, sx * 0.3, 0), bevel=0,
            collection=collection)
    return root


def mortarboard(parent=None, loc=(0, 0, 0), collection=None):
    root = empty('mortarboard', parent, loc, collection)
    cone('cap_band', 0.33, 0.3, 0.13, mat('navy'), root, (0, 0, 0.0), sides=32, bevel=0.01, collection=collection)
    box('cap_board', (0.86, 0.86, 0.035), mat('navy'), root, (0, 0, 0.085), rot=(0.06, 0, math.pi / 4), bevel=0.008, collection=collection)
    cone('cap_button', 0.04, 0.04, 0.02, mat('gold'), root, (0, 0, 0.112), sides=16, bevel=0.004, collection=collection)
    tube('cap_cord', [(0, 0, 0.115), (0.3, -0.25, 0.105), (0.46, -0.4, 0.06), (0.47, -0.41, -0.12)], 0.009, mat('gold'), root,
         collection=collection)
    cone('cap_tassel', 0.03, 0.018, 0.13, mat('gold'), root, (0.47, -0.41, -0.18), sides=12, bevel=0.004, collection=collection)
    return root


def sphere_light(parent, loc, radius, color, strength, collection=None):
    return ball('lamp_bulb', radius, glow(color, color, strength), parent, loc, collection=collection)
