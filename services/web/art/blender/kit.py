"""Shared Blender helpers for the EduAgent X miniature set: materials, primitive
builders, the light rig and the camera. Every script builds its scene from an
empty file, so a render is repeatable from the command line:

    blender --background --python art/blender/<script>.py -- <args>
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# One plate is 1920 x 1080. A room opening is 9.6 x 5.4 units, so the camera
# sees a little of the box edge around it.
PLATE_W, PLATE_H = 1920, 1080
ROOM_W, ROOM_H, ROOM_D = 9.6, 5.4, 5.0
# The robot stands this far behind the room opening.
ROBOT_Y = 1.8
CAM_POS = (0.0, -14.2, 2.9)
CAM_AIM = (0.0, 2.0, 2.55)
CAM_LENS = 50.0


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('HIP', 'OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type != 'CPU']
            if gpus:
                for device in prefs.devices:
                    device.use = device.type != 'CPU'
                scene.cycles.device = 'GPU'
                break
        except (TypeError, RuntimeError):
            continue
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    # Standard keeps the toy colours saturated; the lights are set low enough that nothing clips.
    scene.view_settings.view_transform = 'Standard'
    for look in ('Medium High Contrast', 'None'):
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            continue
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    background = world.node_tree.nodes['Background']
    background.inputs['Color'].default_value = (0.045, 0.05, 0.07, 1)
    background.inputs['Strength'].default_value = 1.0
    scene.world = world
    return scene


def srgb(hex_code):
    """A hex colour as linear RGBA, which is what a shader socket expects."""
    hex_code = hex_code.lstrip('#')
    channels = [int(hex_code[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return (*linear, 1.0)


def material(name, color, rough=0.5, metal=0.0, coat=0.0, emit=0.0, sheen=0.0, sss=0.0, emit_color=None):
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = srgb(color)
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Coat Weight'].default_value = coat
    shader.inputs['Coat Roughness'].default_value = 0.08
    shader.inputs['Sheen Weight'].default_value = sheen
    if sss:
        shader.inputs['Subsurface Weight'].default_value = sss
        shader.inputs['Subsurface Scale'].default_value = 0.05
    if emit:
        shader.inputs['Emission Color'].default_value = srgb(emit_color or color)
        shader.inputs['Emission Strength'].default_value = emit
    return mat


def textured(name, image_path, rough=0.7, scale=1.0, bump=0.0):
    """A material that takes its colour from an image, box-projected so no UV work is needed."""
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = rough
    coords = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (scale, scale, scale)
    image = nodes.new('ShaderNodeTexImage')
    image.image = bpy.data.images.load(image_path, check_existing=True)
    image.projection = 'BOX'
    image.projection_blend = 0.2
    links.new(coords.outputs['Object'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], image.inputs['Vector'])
    links.new(image.outputs['Color'], shader.inputs['Base Color'])
    if bump:
        bump_node = nodes.new('ShaderNodeBump')
        bump_node.inputs['Strength'].default_value = bump
        links.new(image.outputs['Color'], bump_node.inputs['Height'])
        links.new(bump_node.outputs['Normal'], shader.inputs['Normal'])
    return mat


def _finish(name, bm, mat, parent, loc, rot, bevel, segments, collection):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if not bevel:
        # Without a bevel the hard edges must stay hard, or a flat plate shades like a pillow.
        mesh.set_sharp_from_angle(angle=math.radians(60))
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    if mat:
        mesh.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(35)
    obj.modifiers.new('normals', 'WEIGHTED_NORMAL')
    return obj


def box(name, size, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.02, segments=3, collection=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    return _finish(name, bm, mat, parent, loc, rot, bevel, segments, collection)


def cone(name, r_bottom, r_top, depth, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), sides=40, bevel=0.012,
         segments=3, collection=None, spin=0.0):
    """A cylinder or frustum along Z, centred on its own origin."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r_bottom, radius2=r_top, depth=depth)
    if spin:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(spin, 3, 'Z'), verts=bm.verts)
    return _finish(name, bm, mat, parent, loc, rot, bevel, segments, collection)


def ball(name, radius, mat, parent=None, loc=(0, 0, 0), scale=(1, 1, 1), collection=None, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=radius)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return _finish(name, bm, mat, parent, loc, rot, 0, 0, collection)


def tube(name, points, radius, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), sides=14, collection=None):
    """A round tube through a list of points, with rounded ends."""
    bm = bmesh.new()
    rings = []
    count = len(points)
    for i, point in enumerate(points):
        here = Vector(point)
        ahead = Vector(points[min(i + 1, count - 1)]) - Vector(points[max(i - 1, 0)])
        ahead.normalize()
        side = ahead.cross(Vector((0, 1, 0)))
        if side.length < 1e-4:
            side = ahead.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(ahead)
        rings.append([bm.verts.new(here + (side * math.cos(a) + up * math.sin(a)) * radius)
                      for a in (2 * math.pi * k / sides for k in range(sides))])
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bm.normal_update()
    return _finish(name, bm, mat, parent, loc, rot, radius * 0.6, 3, collection)


def plate(name, outline, depth, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, collection=None):
    """A flat shape in the XZ plane, facing -Y, extruded `depth` towards +Y."""
    bm = bmesh.new()
    front = [bm.verts.new((x, 0, z)) for x, z in outline]
    back = [bm.verts.new((x, depth, z)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    count = len(front)
    for k in range(count):
        bm.faces.new((front[k], back[k], back[(k + 1) % count], front[(k + 1) % count]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, mat, parent, loc, rot, bevel, 2, collection)


def rounded_rect(width, height, radius, steps=8):
    points = []
    corners = [(width / 2 - radius, height / 2 - radius, 0), (-width / 2 + radius, height / 2 - radius, 90),
               (-width / 2 + radius, -height / 2 + radius, 180), (width / 2 - radius, -height / 2 + radius, 270)]
    for cx, cz, start in corners:
        for k in range(steps + 1):
            angle = math.radians(start + 90 * k / steps)
            points.append((cx + radius * math.cos(angle), cz + radius * math.sin(angle)))
    return points


def arc_band(radius, thickness, start_deg, end_deg, steps=16):
    """A thick arc with round ends, as an outline for `plate`."""
    outer = [(math.radians(start_deg + (end_deg - start_deg) * k / steps)) for k in range(steps + 1)]
    half = thickness / 2
    points = [((radius + half) * math.cos(a), (radius + half) * math.sin(a)) for a in outer]
    end = outer[-1]
    points += [(radius * math.cos(end) + half * math.cos(end + math.radians(60 * k)), radius * math.sin(end) + half * math.sin(end + math.radians(60 * k))) for k in (1, 2)]
    points += [((radius - half) * math.cos(a), (radius - half) * math.sin(a)) for a in reversed(outer)]
    begin = outer[0]
    points += [(radius * math.cos(begin) + half * math.cos(begin + math.radians(180 + 60 * k)), radius * math.sin(begin) + half * math.sin(begin + math.radians(180 + 60 * k))) for k in (1, 2)]
    return points


def text(name, body, size, mat, parent=None, loc=(0, 0, 0), extrude=0.01, rot=(math.pi / 2, 0, 0), collection=None):
    """Extruded lettering that stands upright and faces the camera."""
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = body
    curve.size = size
    curve.extrude = extrude
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    obj = bpy.data.objects.new(name, curve)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    curve.materials.append(mat)
    return obj


def empty(name, parent=None, loc=(0, 0, 0), collection=None):
    obj = bpy.data.objects.new(name, None)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.empty_display_size = 0.1
    return obj


def aim(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def area_light(name, loc, target, power, color, size, collection=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = color
    data.size = size
    obj = bpy.data.objects.new(name, data)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj.location = loc
    aim(obj, target)
    return obj


def spot_light(name, loc, target, power, color, angle_deg, blend=0.6, radius=0.25, collection=None):
    data = bpy.data.lights.new(name, 'SPOT')
    data.energy = power
    data.color = color
    data.spot_size = math.radians(angle_deg)
    data.spot_blend = blend
    data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj.location = loc
    aim(obj, target)
    return obj


def stage_lights(center=(0.0, ROBOT_Y, 0.0), strength=1.0, collection=None):
    """The rig every plate and sprite shares: warm key from the upper left,
    cool fill from the right, a rim from behind and a pendant lamp overhead."""
    cx, cy, cz = center
    focus = (cx, cy, cz + 1.2)
    return [
        area_light('key', (cx - 4.6, cy - 6.0, cz + 6.4), focus, 1500 * strength, (1.0, 0.84, 0.66), 3.0, collection),
        area_light('fill', (cx + 5.5, cy - 6.5, cz + 2.4), focus, 320 * strength, (0.72, 0.84, 1.0), 6.0, collection),
        area_light('rim', (cx + 2.6, cy + 2.6, cz + 4.6), (cx, cy, cz + 1.6), 700 * strength, (1.0, 0.92, 0.82), 1.6, collection),
        spot_light('pendant', (cx, cy - 0.4, cz + 4.5), (cx, cy - 0.1, cz), 900 * strength, (1.0, 0.8, 0.55), 78, 0.7, 0.3, collection),
    ]


def stage_camera(scale=1.0):
    scene = bpy.context.scene
    data = bpy.data.cameras.new('camera')
    data.lens = CAM_LENS
    data.sensor_width = 36
    obj = bpy.data.objects.new('camera', data)
    scene.collection.objects.link(obj)
    obj.location = CAM_POS
    aim(obj, CAM_AIM)
    scene.camera = obj
    scene.render.resolution_x = int(PLATE_W * scale)
    scene.render.resolution_y = int(PLATE_H * scale)
    scene.render.resolution_percentage = 100
    return obj


def project(world_point):
    """A world point as plate pixels (x from the left, y from the top) at scale 1."""
    from bpy_extras.object_utils import world_to_camera_view
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    ndc = world_to_camera_view(scene, scene.camera, Vector(world_point))
    return (ndc.x * PLATE_W, (1 - ndc.y) * PLATE_H)
