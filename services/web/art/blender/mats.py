"""Procedural materials, the wide plate camera and small scene helpers for the rooms.
Nothing here needs an image file, so a render is repeatable on any machine.
"""
import math

import bpy

from kit import CAM_LENS, PLATE_H, PLATE_W, project, srgb, stage_camera

# A room plate shows this much more than the reference frame on every side, so the
# box frame, the plaque beam and the table are in the picture. The pixels per unit stay
# the same as the sprites when the plate is drawn at WIDE times the reference size.
WIDE = 1.2


def wide_camera(scale=1.0):
    camera = stage_camera(scale)
    camera.data.lens = CAM_LENS / WIDE
    return camera


def project_ref(world_point):
    """A world point in reference plate pixels, when the scene camera is the wide camera."""
    x, y = project(world_point)
    return ((x - PLATE_W / 2) * WIDE + PLATE_W / 2, (y - PLATE_H / 2) * WIDE + PLATE_H / 2)


def _object_coords(mat, scale, rotation=(0, 0, 0)):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = scale
    mapping.inputs['Rotation'].default_value = rotation
    links.new(coords.outputs['Object'], mapping.inputs['Vector'])
    return mapping.outputs['Vector']


def grain(name, light, dark, scale=(9, 0.7, 9), rough=0.55, coat=0.15, bump=0.12, detail=6.0):
    """A two-tone noise material. Stretched along one axis it is wood grain; even, it is plaster or cork."""
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Coat Weight'].default_value = coat
    shader.inputs['Coat Roughness'].default_value = 0.15
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.0
    noise.inputs['Detail'].default_value = detail
    links.new(_object_coords(mat, scale), noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.36
    ramp.color_ramp.elements[0].color = srgb(dark)
    ramp.color_ramp.elements[1].position = 0.66
    ramp.color_ramp.elements[1].color = srgb(light)
    links.new(noise.outputs[0], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], shader.inputs['Base Color'])
    if bump:
        bump_node = nodes.new('ShaderNodeBump')
        bump_node.inputs['Strength'].default_value = bump
        links.new(noise.outputs[0], bump_node.inputs['Height'])
        links.new(bump_node.outputs['Normal'], shader.inputs['Normal'])
    return mat


def bricks(name, brick, brick_alt, mortar, scale=2.6, rough=0.9):
    """A brick wall for a face in the XZ plane."""
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = rough
    tex = nodes.new('ShaderNodeTexBrick')
    tex.inputs['Color1'].default_value = srgb(brick)
    tex.inputs['Color2'].default_value = srgb(brick_alt)
    tex.inputs['Mortar'].default_value = srgb(mortar)
    tex.inputs['Scale'].default_value = scale
    tex.inputs['Mortar Size'].default_value = 0.012
    links.new(_object_coords(mat, (1, 1, 1), (math.pi / 2, 0, 0)), tex.inputs['Vector'])
    links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    bump_node = nodes.new('ShaderNodeBump')
    bump_node.inputs['Strength'].default_value = 0.35
    links.new(tex.outputs['Fac'], bump_node.inputs['Height'])
    links.new(bump_node.outputs['Normal'], shader.inputs['Normal'])
    return mat


def globe_map(name='globe_map'):
    """The painted map of a desk globe: noise decides sea or land, a second ramp shades the sea by depth
    and the land from green lowland to tan upland. The paint is glossy, like a varnished globe."""
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = 0.35
    shader.inputs['Coat Weight'].default_value = 0.6
    shader.inputs['Coat Roughness'].default_value = 0.1
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.0
    noise.inputs['Detail'].default_value = 7.0
    noise.inputs['Roughness'].default_value = 0.55
    links.new(_object_coords(mat, (2.6, 2.6, 3.4)), noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    stops = [(0.0, '#1F4E8C'), (0.47, '#3F7FC4'), (0.515, '#7FB4DE'), (0.52, '#5E9A52'), (0.6, '#7DAE5B'), (0.72, '#C9B272')]
    first, last = ramp.color_ramp.elements
    first.position, first.color = stops[0][0], srgb(stops[0][1])
    last.position, last.color = stops[-1][0], srgb(stops[-1][1])
    for position, color in stops[1:-1]:
        ramp.color_ramp.elements.new(position).color = srgb(color)
    links.new(noise.outputs[0], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], shader.inputs['Base Color'])
    return mat


def sky(name, low, high, height, glow=0.75):
    """A painted backdrop: `low` at the bottom of the object, `high` at the top, lit from within so it stays even."""
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = 0.95
    split = nodes.new('ShaderNodeSeparateXYZ')
    links.new(_object_coords(mat, (1, 1, 1)), split.inputs['Vector'])
    remap = nodes.new('ShaderNodeMapRange')
    remap.inputs['From Min'].default_value = -height / 2
    remap.inputs['From Max'].default_value = height / 2
    links.new(split.outputs['Z'], remap.inputs['Value'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = srgb(low)
    ramp.color_ramp.elements[1].color = srgb(high)
    links.new(remap.outputs['Result'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], shader.inputs['Base Color'])
    links.new(ramp.outputs['Color'], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = glow
    return mat


def point_light(name, parent, loc, power, color=(1.0, 0.82, 0.58), radius=0.12):
    data = bpy.data.lights.new(name, 'POINT')
    data.energy = power
    data.color = color
    data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    return obj


def tree(obj):
    yield obj
    for child in obj.children:
        yield from tree(child)
