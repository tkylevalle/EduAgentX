"""Quill's poses and loops. This file has no Blender import, so the frontend's
pose names and the renders come from one table.

An arm is (side, forward, bend, roll) in degrees. `side` raises the arm in the
screen plane: a positive left arm and a negative right arm swing outwards
(left and right are the viewer's). `forward` swings it towards the camera,
`bend` folds the elbow forwards and `roll` turns the forearm in the screen plane.
"""
import math

DEFAULT_FRAMES = 12
FPS = 12

POSES = {
    'idle': dict(L=(8, 0, 12, 0), R=(-8, 0, 12, 0), eyes='open', mouth='smile', anim='idle', frames=24),
    'walk': dict(L=(6, 0, 18, 0), R=(-6, 0, 18, 0), eyes='open', mouth='smile', anim='walk', face=52, turn=-30),
    'read': dict(L=(-4, 25, 70, -22), R=(4, 25, 70, 22), nod=8, eyes='open', mouth='smile', anim='scan', look=(0, 6),
                 props=['book'], cap=False),
    'enrol': dict(L=(42, 0, 12, 0), R=(-42, 0, 12, 0), eyes='wide', mouth='open', anim='boot', look=(0, -2), cap=False),
    'study': dict(L=(-8, 45, 55, -25), R=(8, 45, 55, 25), nod=10, eyes='open', mouth='flat', anim='scan', look=(0, 7),
                  sit=True, props=['seat', 'desk_book', 'desk_books'], cap=False),
    'exam': dict(L=(-8, 45, 55, -25), R=(10, 45, 55, 32), nod=11, tilt=4, eyes='focus', mouth='flat', anim='write',
                 look=(4, 7), sit=True, props=['seat', 'desk_paper', 'pencil'], cap=False),
    'cheer': dict(L=(150, 0, 14, 0), R=(-150, 0, 14, 0), eyes='happy', mouth='open', anim='hop'),
    'report': dict(L=(140, 0, 10, 0), R=(-30, 0, 25, 0), tilt=-5, eyes='happy', mouth='open', anim='sway', look=(-5, -3),
                   props=['card'], cap=False),
    'glum': dict(L=(6, 35, 60, -30), R=(-5, 0, 8, 0), nod=10, tilt=4, eyes='sad', mouth='frown', anim='still',
                 look=(-3, 7), props=['card'], prop_tilt={'card': (-25, 0, 0)}, cap=False),
    'wait': dict(L=(-6, 35, 75, -38), R=(6, 35, 75, 38), eyes='wide', mouth='o', anim='bounce', look=(0, -5), cap=False),
    'graduate': dict(L=(150, 0, 14, 0), R=(-150, 0, 14, 0), eyes='happy', mouth='open', anim='hop', props=['scroll']),
    'present': dict(L=(62, 25, 25, 0), R=(-8, 0, 12, 0), tilt=-6, eyes='open', mouth='smile', anim='still', look=(-6, 0),
                    props=['diploma']),
    'worried': dict(L=(62, 25, 25, 0), R=(24, 30, 55, 10), tilt=-4, eyes='wide', mouth='o', anim='shake', look=(-7, 1),
                    props=['diploma_hold']),
    'wave': dict(L=(10, 0, 14, 0), R=(-140, 0, 10, -20), eyes='happy', mouth='open', anim='wave', props=['scroll']),
    'proud': dict(L=(46, 0, 0, -100), R=(-46, 0, 0, 100), nod=-6, eyes='happy', mouth='smile', anim='sway'),
    'resolve': dict(L=(14, 0, 12, 0), R=(-140, 0, 10, -35), eyes='focus', mouth='flat', anim='still', cap=False),
    'confused': dict(L=(10, 0, 12, 0), R=(-128, 0, 0, -76), tilt=9, eyes='uneven', mouth='wavy', anim='scratch',
                     look=(4, -3), query=True),
}

# How far the body drops onto the chair, and how far the legs fold under the desk (degrees).
SIT_DROP = 0.06
SIT_LEGS = -78
# Frames of a loop on which the eyes are shut, by motion.
BLINKS = {'idle': (17, 18), 'still': (8,), 'sway': (8,), 'scan': (9,)}


def frames_of(name):
    return POSES[name].get('frames', DEFAULT_FRAMES)


def _base(pose):
    seated = pose.get('sit', False)
    return {
        'face': pose.get('face', 0), 'shift': 0.0, 'hop': 0.0, 'bob': 0.0, 'sit': SIT_DROP if seated else 0.0,
        'lean': 0.0, 'roll': 0.0, 'nod': pose.get('nod', 0), 'tilt': pose.get('tilt', 0), 'turn': pose.get('turn', 0),
        'look': list(pose.get('look', (0, 0))), 'armL': list(pose['L']), 'armR': list(pose['R']),
        'legL': SIT_LEGS if seated else 0.0, 'legR': SIT_LEGS if seated else 0.0,
        'eyes': pose['eyes'], 'mouth': pose['mouth'], 'query': pose.get('query', False),
        'props': list(pose.get('props', [])), 'prop_tilt': pose.get('prop_tilt'),
    }


def _idle(s, t):
    s['bob'] = 0.012 * math.sin(t)
    s['armL'][0] += 2 * math.sin(t)
    s['armR'][0] -= 2 * math.sin(t)
    s['tilt'] += 1.5 * math.sin(t)


def _walk(s, t):
    swing = math.sin(t)
    s['legL'], s['legR'] = 30 * swing, -30 * swing
    s['armL'][1], s['armR'][1] = 24 * swing, -24 * swing
    s['bob'] = 0.03 * abs(math.cos(t))
    s['roll'] = 2 * swing
    s['lean'] = 4


def _still(s, t):
    s['bob'] = 0.006 * math.sin(t)


def _boot(s, t):
    s['bob'] = 0.02 * math.sin(t)
    s['armL'][0] += 6 * math.sin(2 * t)
    s['armR'][0] -= 6 * math.sin(2 * t)


def _scan(s, t):
    s['turn'] += 7 * math.sin(t)
    s['look'][0] += 4 * math.sin(t)
    s['bob'] = 0.004 * math.sin(2 * t)


def _write(s, t):
    s['armR'][3] += 6 * math.sin(2 * t)
    s['armR'][2] += 3 * math.sin(2 * t + 1)
    s['nod'] += 1.5 * math.sin(t)
    s['look'][0] += 2 * math.sin(2 * t)


def _hop(s, t):
    air = max(0.0, math.sin(t))
    s['hop'] = 0.2 * air
    s['bob'] = -0.035 * max(0.0, -math.sin(t))
    s['armL'][0] += 9 * math.cos(t)
    s['armR'][0] -= 9 * math.cos(t)
    s['legL'], s['legR'] = -12 * air, 8 * air


def _sway(s, t):
    s['roll'] = 2.5 * math.sin(t)
    s['tilt'] -= 2 * math.sin(t)
    s['bob'] = 0.008 * math.sin(2 * t)


def _bounce(s, t):
    s['bob'] = 0.03 * abs(math.sin(t))
    s['armL'][2] += 4 * math.sin(t)
    s['armR'][2] += 4 * math.sin(t)


def _shake(s, t):
    s['shift'] = 0.014 * math.sin(3 * t)
    s['tilt'] += 1.5 * math.sin(3 * t)


def _wave(s, t):
    s['armR'][3] += 24 * math.sin(2 * t)
    s['bob'] = 0.01 * math.sin(t)
    s['tilt'] += 2 * math.sin(t)


def _scratch(s, t):
    s['armR'][3] += 7 * math.sin(2 * t)
    s['tilt'] += math.sin(t)


MOTIONS = {'idle': _idle, 'walk': _walk, 'still': _still, 'boot': _boot, 'scan': _scan, 'write': _write, 'hop': _hop,
           'sway': _sway, 'bounce': _bounce, 'shake': _shake, 'wave': _wave, 'scratch': _scratch}


def state_at(name, index):
    """The rig state of pose `name` on frame `index` of its loop."""
    pose = POSES[name]
    state = _base(pose)
    MOTIONS[pose['anim']](state, 2 * math.pi * index / frames_of(name))
    if state['eyes'] == 'open' and index in BLINKS.get(pose['anim'], ()):
        state['eyes'] = 'blink'
    return state
