"""Quill, the student robot: a pencil that went to school. This script builds
the model from primitives, poses it, and renders stop-motion loops with a
transparent background through the same camera and lights as the room plates.

    blender --background --python art/blender/quill.py -- sheet          one frame of every pose, for review
    blender --background --python art/blender/quill.py -- render [pose…] full loops (all poses when none is named)
    blender --background --python art/blender/quill.py -- desk           the empty desk and chair, in the same frame
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import kit  # noqa: E402
import props  # noqa: E402
from kit import ROBOT_Y, arc_band, ball, box, cone, empty, material, plate, rounded_rect, text, tube  # noqa: E402
from quill_poses import POSES, frames_of, state_at  # noqa: E402

OUT = os.path.normpath(os.path.join(HERE, '..', 'renders', 'quill'))
# The sprite frame is a square of this many world units, centred this high above the floor.
FRAME_UNITS = 3.4
FRAME_CENTER_Z = 1.48
FRAME_PX = 512
SHEET_PX = 288
# Samples per frame of the final loops. The denoiser cleans the rest.
RENDER_SAMPLES = 64
# The head is a little larger than the build size: a big head reads as a young student.
HEAD_SCALE = 1.12
# The hex torso turns so one flat face looks at the camera.
TORSO_SPIN = math.radians(30)


def materials():
    m = _materials()
    # The visor is matt black glass: with a normal highlight the fill light turns the whole face grey.
    m['glass'].node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.08
    return m


def _materials():
    return {
        'yellow': material('quill_yellow', '#FDAE12', rough=0.34, coat=0.35),
        'graphite': material('quill_graphite', '#34343A', rough=0.42, metal=0.35),
        'dark': material('quill_dark', '#232227', rough=0.6),
        'wood': material('quill_wood', '#E2B77C', rough=0.75),
        'ferrule': material('quill_ferrule', '#C6CAD1', rough=0.26, metal=1.0),
        'eraser': material('quill_eraser', '#EE8B94', rough=0.82, sss=0.15),
        'glass': material('quill_glass', '#07090D', rough=0.38),
        'led': material('quill_led', '#FFF1CF', rough=0.4, emit=9.0),
        'heart': material('quill_heart', '#FFB347', rough=0.4, emit=6.0),
        'cream': material('quill_cream', '#F1E6CC', rough=0.5),
        'green': material('quill_green', '#3F7D5C', rough=0.85, sheen=0.4),
        'query': material('quill_query', '#F6B81A', rough=0.4, emit=2.5),
    }


def fluted(name, radius, depth, mat, parent, loc, flutes=30):
    """The crimped metal band of a pencil: a cylinder whose wall alternates in and out."""
    bm = bmesh.new()
    count = flutes * 2
    rings = []
    for z in (-depth / 2, depth / 2):
        rings.append([bm.verts.new((math.cos(2 * math.pi * k / count) * radius * (1.0 if k % 2 else 0.95),
                                    math.sin(2 * math.pi * k / count) * radius * (1.0 if k % 2 else 0.95), z))
                      for k in range(count)])
    for k in range(count):
        bm.faces.new((rings[0][k], rings[0][(k + 1) % count], rings[1][(k + 1) % count], rings[1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    return kit._finish(name, bm, mat, parent, loc, (0, 0, 0), 0, 0, None)


def build_legs(rig, m):
    for side, x in (('L', -0.17), ('R', 0.17)):
        hip = empty(f'hip{side}', rig['lift'], (x, 0, 0.46))
        tube(f'leg{side}', [(0, 0, 0.02), (0, 0, -0.3)], 0.066, m['graphite'], hip)
        box(f'boot{side}', (0.26, 0.38, 0.18), m['yellow'], hip, (0, -0.05, -0.345), bevel=0.07, segments=5)
        box(f'sole{side}', (0.27, 0.39, 0.05), m['dark'], hip, (0, -0.05, -0.435), bevel=0.02)
        rig[f'hip{side}'] = hip


def build_body(rig, m):
    body = rig['body']
    cone('pelvis', 0.2, 0.26, 0.16, m['graphite'], body, (0, 0, 0.48))
    cone('hem', 0.21, 0.37, 0.15, m['wood'], body, (0, 0, 0.565), sides=6, bevel=0.02, spin=TORSO_SPIN)
    cone('torso', 0.37, 0.37, 0.46, m['yellow'], body, (0, 0, 0.87), sides=6, bevel=0.05, segments=4, spin=TORSO_SPIN)
    cone('collar', 0.2, 0.17, 0.05, m['graphite'], body, (0, 0, 1.115))
    cone('neck', 0.11, 0.11, 0.1, m['graphite'], body, (0, 0, 1.15))
    front = -0.37 * math.cos(math.radians(30))
    for sx in (-1, 1):
        box('strap', (0.075, 0.03, 0.47), m['green'], body, (sx * 0.2, front - 0.008, 0.87), bevel=0.01)
        box('strap_top', (0.075, 0.36, 0.03), m['green'], body, (sx * 0.2, front + 0.17, 1.098), bevel=0.01)
    cone('heart_bezel', 0.07, 0.07, 0.03, m['dark'], body, (0, front - 0.004, 0.93), rot=(math.pi / 2, 0, 0), sides=24, bevel=0.006)
    cone('heart', 0.045, 0.045, 0.012, m['heart'], body, (0, front - 0.02, 0.93), rot=(math.pi / 2, 0, 0), sides=24, bevel=0)
    box('pack', (0.6, 0.3, 0.52), m['green'], body, (0, 0.43, 0.86), bevel=0.1, segments=5)
    box('pack_pocket', (0.4, 0.1, 0.22), m['green'], body, (0, 0.59, 0.76), bevel=0.04)
    box('pack_buckle', (0.09, 0.02, 0.06), m['ferrule'], body, (0, 0.645, 0.8), bevel=0.006)


def build_head(rig, m):
    head = rig['head']
    box('skull', (1.0, 0.86, 0.6), m['yellow'], head, (0, 0, 0.31), bevel=0.2, segments=8)
    plate('visor', rounded_rect(0.76, 0.4, 0.17), 0.05, m['glass'], head, (0, -0.458, 0.3), bevel=0.014)
    for sx in (-1, 1):
        cone('ear', 0.15, 0.15, 0.09, m['yellow'], head, (sx * 0.51, 0, 0.3), rot=(0, math.pi / 2, 0), sides=32, bevel=0.02)
        cone('ear_ring', 0.17, 0.17, 0.03, m['ferrule'], head, (sx * 0.485, 0, 0.3), rot=(0, math.pi / 2, 0), sides=32, bevel=0.006)
        cone('ear_bolt', 0.055, 0.055, 0.03, m['graphite'], head, (sx * 0.56, 0, 0.3), rot=(0, math.pi / 2, 0), sides=16, bevel=0.008)
    fluted('ferrule', 0.425, 0.2, m['ferrule'], head, (0, 0, 0.7))
    for z in (0.6, 0.8):
        cone('ferrule_ridge', 0.435, 0.435, 0.03, m['ferrule'], head, (0, 0, z), sides=48, bevel=0.008)
    cone('eraser_base', 0.405, 0.405, 0.14, m['eraser'], head, (0, 0, 0.88), sides=48, bevel=0)
    ball('eraser_top', 0.405, m['eraser'], head, (0, 0, 0.95), scale=(1, 1, 0.72))


def wavy_band(width, amplitude, thickness, steps=24):
    top = [(-width / 2 + width * k / steps, amplitude * math.sin(3 * math.pi * k / steps) + thickness / 2) for k in range(steps + 1)]
    bottom = [(x, z - thickness) for x, z in reversed(top)]
    return top + bottom


def build_face(rig, m):
    face = empty('face', rig['head'], (0, -0.464, 0.3))
    eyes_root = empty('eyes', face, (0, 0, 0))
    rig['eyes_root'] = eyes_root
    led = m['led']

    def pair(outline, tilt=0.0):
        return [plate('eye', outline, 0.006, led, eyes_root, (sx * 0.175, 0, 0.035), rot=(0, sx * tilt, 0)) for sx in (-1, 1)]

    capsule = rounded_rect(0.1, 0.19, 0.0499)
    circle = rounded_rect(0.2, 0.2, 0.0999)
    squint = rounded_rect(0.15, 0.07, 0.0349)
    rig['eyes'] = {
        'open': pair(capsule), 'wide': pair(circle), 'focus': pair(squint, -0.22),
        'happy': pair(arc_band(0.075, 0.042, 20, 160)), 'sad': pair(rounded_rect(0.15, 0.085, 0.042), 0.42),
        'blink': pair(rounded_rect(0.14, 0.03, 0.0149)),
        'uneven': [plate('eye', circle, 0.006, led, eyes_root, (-0.175, 0, 0.035)),
                   plate('eye', squint, 0.006, led, eyes_root, (0.175, 0, 0.03), rot=(0, -0.2, 0))],
    }
    half_disc = [(0.085 * math.cos(math.radians(a)), 0.085 * math.sin(math.radians(a))) for a in range(180, 361, 12)]
    rig['mouth'] = {
        'smile': [plate('mouth', arc_band(0.085, 0.03, 205, 335), 0.006, led, face, (0, 0, -0.045))],
        'open': [plate('mouth', half_disc, 0.006, led, face, (0, 0, -0.085))],
        'flat': [plate('mouth', rounded_rect(0.12, 0.03, 0.0149), 0.006, led, face, (0, 0, -0.115))],
        'frown': [plate('mouth', arc_band(0.085, 0.03, 25, 155), 0.006, led, face, (0, 0, -0.2))],
        'o': [plate('mouth', rounded_rect(0.085, 0.095, 0.042), 0.006, led, face, (0, 0, -0.115))],
        'wavy': [plate('mouth', wavy_band(0.2, 0.018, 0.028), 0.006, led, face, (0, 0, -0.115))],
    }
    rig['query'] = text('query', '?', 0.6, m['query'], rig['head'], (0.62, -0.3, 1.05), extrude=0.03,
                        rot=(math.pi / 2, 0.25, 0))


def build_arm(rig, m, side, x):
    shoulder = empty(f'shoulder{side}', rig['body'], (x, 0, 0.99))
    ball('shoulder_ball', 0.105, m['graphite'], shoulder)
    tube('upper_arm', [(0, 0, -0.03), (0, 0, -0.25)], 0.058, m['graphite'], shoulder)
    elbow = empty(f'elbow{side}', shoulder, (0, 0, -0.27))
    ball('elbow_ball', 0.072, m['graphite'], elbow)
    cone('cuff', 0.105, 0.07, 0.25, m['cream'], elbow, (0, 0, -0.16), bevel=0.02)
    hand = empty(f'hand{side}', elbow, (0, 0, -0.3))
    arc = [(0.088 * math.cos(math.radians(a)), 0, -0.075 + 0.088 * math.sin(math.radians(a))) for a in range(-55, 236, 29)]
    tube('clamp', arc, 0.036, m['graphite'], hand)
    cone('wrist', 0.06, 0.06, 0.05, m['graphite'], hand, (0, 0, 0.005), bevel=0.01)
    grip = empty(f'grip{side}', hand, (0, 0, -0.075))
    rig.update({f'shoulder{side}': shoulder, f'elbow{side}': elbow, f'grip{side}': grip})


def build_props(rig):
    """Everything Quill can hold or sit at. A pose shows the ones it names."""
    body, grip_l, grip_r = rig['body'], rig['gripL'], rig['gripR']
    seat = empty('seat', rig['root'], (0, 0, 0))
    props.desk(seat, (0, -0.56, 0))
    props.chair(seat, (0, 0.12, 0))
    desk_top = empty('desk_top', seat, (0, -0.56, 0.66))
    rig['props'] = {
        'seat': seat,
        'book': props.open_book(body, (0, -0.58, 0.7), rot=(math.radians(-52), 0, 0), scale=0.95),
        'desk_book': props.open_book(desk_top, (0, 0.02, 0), rot=(math.radians(8), 0, 0)),
        'desk_books': props.book_stack(desk_top, (-0.44, 0.12, 0), covers=('green', 'red')),
        'desk_paper': props.paper_sheet(desk_top, (0.02, 0.0, 0), rot=(0, 0, -0.12)),
        'pencil': props.pencil(grip_r, (0, 0, -0.1), rot=(math.radians(-150), math.radians(-20), 0), length=0.32),
        'card': props.report_card(grip_l, (0, -0.06, -0.04)),
        'diploma': props.diploma(grip_l, (0, -0.07, 0.2)),
        'diploma_hold': props.diploma(grip_l, (0, -0.07, 0.2), hold=True),
        'scroll': props.scroll(grip_l, (0, -0.02, 0)),
        'cap': props.mortarboard(rig['head'], (0, 0, 1.2)),
    }


def build_rig():
    m = materials()
    root = empty('quill', None, (0, ROBOT_Y, 0))
    lift = empty('lift', root)
    body = empty('body', lift)
    head = empty('head', body, (0, 0, 1.17))
    head.scale = (HEAD_SCALE, HEAD_SCALE, HEAD_SCALE)
    rig = {'root': root, 'lift': lift, 'body': body, 'head': head}
    build_legs(rig, m)
    build_body(rig, m)
    build_head(rig, m)
    build_face(rig, m)
    build_arm(rig, m, 'L', -0.46)
    build_arm(rig, m, 'R', 0.46)
    build_props(rig)
    # The floor only catches shadows, but the visor reflects it, so it is as dark as a room floor.
    floor = box('floor', (16, 12, 0.02), m['dark'], None, (0, ROBOT_Y, -0.01), bevel=0)
    floor.is_shadow_catcher = True
    rig['floor'] = floor
    return rig


def tree(obj):
    yield obj
    for child in obj.children:
        yield from tree(child)


def show(obj, visible):
    for node in tree(obj):
        node.hide_render = not visible


def apply(rig, state):
    """Put the rig in one moment of a pose. `state` comes from quill_poses.state_at."""
    rad = math.radians
    rig['root'].rotation_euler = (0, 0, rad(state['face']))
    rig['lift'].location = (state['shift'], 0, state['hop'])
    rig['body'].location = (0, 0, state['bob'] - state['sit'])
    rig['body'].rotation_euler = (rad(state['lean']), rad(state['roll']), 0)
    rig['head'].rotation_euler = (rad(state['nod']), rad(state['tilt']), rad(state['turn']))
    rig['eyes_root'].location = (state['look'][0] * 0.006, 0, -state['look'][1] * 0.006)
    for side in 'LR':
        arm = state['arm' + side]
        shoulder = Euler((rad(-arm[1]), rad(arm[0]), 0))
        elbow = Euler((rad(-arm[2]), rad(arm[3]), 0))
        rig['shoulder' + side].rotation_euler = shoulder
        rig['elbow' + side].rotation_euler = elbow
        # A held prop stays upright whatever the arm does: the grip undoes the arm's turn.
        rig['grip' + side].rotation_euler = (shoulder.to_matrix() @ elbow.to_matrix()).inverted().to_euler()
        rig['hip' + side].rotation_euler = (rad(state['leg' + side]), 0, 0)
        rig['hip' + side].location.z = 0.46 - state['sit']
    for name, objects in rig['eyes'].items():
        for obj in objects:
            obj.hide_render = name != state['eyes']
    for name, objects in rig['mouth'].items():
        for obj in objects:
            obj.hide_render = name != state['mouth']
    rig['query'].hide_render = not state['query']
    for name, prop in rig['props'].items():
        show(prop, name in state['props'])
    tilt = state.get('prop_tilt')
    if tilt:
        for name, angles in tilt.items():
            rig['props'][name].rotation_euler = tuple(rad(a) for a in angles)


def sprite_camera(pixels):
    """The stage camera, cropped to the square around Quill. Same position, so the perspective matches the plates."""
    camera = kit.stage_camera()
    cx, cy = kit.project((0, ROBOT_Y, FRAME_CENTER_Z))
    left, _ = kit.project((-FRAME_UNITS / 2, ROBOT_Y, FRAME_CENTER_Z))
    right, _ = kit.project((FRAME_UNITS / 2, ROBOT_Y, FRAME_CENTER_Z))
    foot = kit.project((0, ROBOT_Y, 0))
    span = right - left
    fraction = span / kit.PLATE_W
    camera.data.lens = kit.CAM_LENS / fraction
    camera.data.shift_x = ((cx - kit.PLATE_W / 2) / kit.PLATE_W) / fraction
    camera.data.shift_y = ((kit.PLATE_H / 2 - cy) / kit.PLATE_W) / fraction
    scene = bpy.context.scene
    scene.render.resolution_x = pixels
    scene.render.resolution_y = pixels
    return {'framePlatePx': round(span, 2), 'centerPlate': [round(cx, 2), round(cy, 2)], 'footPlate': [round(foot[0], 2), round(foot[1], 2)]}


def render(path):
    scene = bpy.context.scene
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def cap_pass(rig, on):
    """For the cap layer everything but the cap becomes a holdout, so the cap is cut where the head hides it."""
    cap_nodes = set(tree(rig['props']['cap']))
    for node in tree(rig['root']):
        if node.type in {'MESH', 'FONT'} and node not in cap_nodes:
            node.is_holdout = on
    rig['floor'].hide_render = on


def render_pose(rig, name, samples):
    scene = bpy.context.scene
    scene.cycles.samples = samples
    count = frames_of(name)
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    for index in range(count):
        state = state_at(name, index)
        apply(rig, {**state, 'props': [p for p in state['props'] if p != 'cap']})
        render(os.path.join(folder, f'f{index:02d}.png'))
        if POSES[name].get('cap', True):
            apply(rig, {**state, 'props': state['props'] + ['cap']})
            cap_pass(rig, True)
            render(os.path.join(folder, f'c{index:02d}.png'))
            cap_pass(rig, False)
    return count


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['sheet']
    mode, names = args[0], args[1:]
    scene = kit.reset_scene()
    scene.render.use_persistent_data = True
    rig = build_rig()
    kit.stage_lights((0, ROBOT_Y, 0))
    os.makedirs(OUT, exist_ok=True)
    if mode == 'sheet':
        sprite_camera(SHEET_PX)
        scene.cycles.samples = 24
        for name in names or POSES:
            state = state_at(name, frames_of(name) // 4)
            apply(rig, {**state, 'props': state['props'] + (['cap'] if name in ('graduate', 'proud') else [])})
            render(os.path.join(OUT, '_sheet', f'{name}.png'))
        return
    frame = sprite_camera(FRAME_PX)
    if mode == 'desk':
        # The desk a seated pose bakes in, on its own, for the moments Quill is not sitting at it.
        scene.cycles.samples = RENDER_SAMPLES
        show(rig['root'], False)
        show(rig['props']['seat'], True)
        for name in ('desk_book', 'desk_books', 'desk_paper'):
            show(rig['props'][name], False)
        render(os.path.join(OUT, 'desk', 'f00.png'))
        return
    manifest_path = os.path.join(OUT, 'frames.json')
    manifest = {'frame': FRAME_PX, **frame, 'poses': {}}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as handle:
            manifest['poses'] = json.load(handle).get('poses', {})
    for name in names or POSES:
        count = render_pose(rig, name, RENDER_SAMPLES)
        manifest['poses'][name] = {'frames': count, 'fps': POSES[name].get('fps', 12), 'cap': POSES[name].get('cap', True)}
        with open(manifest_path, 'w', encoding='utf-8') as handle:
            json.dump(manifest, handle, indent=2)


main()
