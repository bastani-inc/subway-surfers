"""Diagnostics for rigging: slice profiles and orthographic views of a character, plus BVH stats.

    blender -b --python scripts/blender/probe_rig.py -- mesh assets/rig_src/runner.glb /tmp/probe_runner
    blender -b --python scripts/blender/probe_rig.py -- bvh assets/mocap/127_06.bvh
"""

import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
mode = args[0]
bpy.ops.wm.read_factory_settings(use_empty=True)


def probe_mesh(path, out_prefix):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    zmax = max(p.z for p in pts)
    print(f"verts={len(pts)} x[{min(p.x for p in pts):.3f},{max(p.x for p in pts):.3f}] "
          f"y[{min(p.y for p in pts):.3f},{max(p.y for p in pts):.3f}] z[0,{zmax:.3f}]")
    step = 0.04
    for i in range(int(zmax / step) + 1):
        z0 = i * step
        sl = sorted(p.x for p in pts if z0 <= p.z < z0 + step)
        if not sl:
            continue
        runs, start = [], sl[0]
        for a, b in zip(sl, sl[1:]):
            if b - a > 0.02:
                runs.append((start, a))
                start = b
        runs.append((start, sl[-1]))
        ys = [p.y for p in pts if z0 <= p.z < z0 + step]
        print(f"z={z0:.2f} y[{min(ys):+.3f},{max(ys):+.3f}] x-runs " + " ".join(f"[{a:+.3f},{b:+.3f}]" for a, b in runs))

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = 1024
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    sc.world = world
    for k in range(18):
        z = k * 0.1
        bpy.ops.mesh.primitive_cylinder_add(radius=0.002, depth=2.0, location=(0, 0, z), rotation=(0, math.radians(90), 0))
        bpy.ops.mesh.primitive_cylinder_add(radius=0.002, depth=2.0, location=(0, 0, z), rotation=(math.radians(90), 0, 0))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = zmax * 1.1
    sc.collection.objects.link(cam)
    sc.camera = cam
    for name, loc, rot in (("front", (0, 5, zmax / 2), (math.radians(90), 0, math.radians(180))),
                           ("side", (5, 0, zmax / 2), (math.radians(90), 0, math.radians(90)))):
        cam.location = loc
        cam.rotation_euler = rot
        sc.render.filepath = f"{out_prefix}_{name}.png"
        bpy.ops.render.render(write_still=True)


def probe_bvh(path):
    bpy.ops.import_anim.bvh(filepath=path, global_scale=1.0, use_fps_scale=False, update_scene_fps=True, update_scene_duration=True)
    arm = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
    sc = bpy.context.scene
    print("bones:", [b.name for b in arm.data.bones])
    hips = arm.pose.bones["Hips"]
    rest = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
    leg = (rest["LeftUpLeg"] - rest["LeftFoot"]).length
    print(f"fps={sc.render.fps} frames={sc.frame_start}..{sc.frame_end} leg(upleg->foot)={leg:.3f} hip_height_rest={rest['LeftUpLeg'].z - min(v.z for v in rest.values()):.3f}")
    rows = []
    for f in range(sc.frame_start, sc.frame_end + 1):
        sc.frame_set(f)
        h = arm.matrix_world @ hips.head
        lf = arm.matrix_world @ arm.pose.bones["LeftToeBase"].head
        rf = arm.matrix_world @ arm.pose.bones["RightToeBase"].head
        rows.append((f, h, lf, rf))
    for f, h, lf, rf in rows[::6]:
        print(f"f={f:4d} hip=({h.x:7.2f},{h.y:7.2f},{h.z:6.2f}) Ltoe_z={lf.z:6.2f} Rtoe_z={rf.z:6.2f}")


if mode == "mesh":
    probe_mesh(args[1], args[2])
else:
    probe_bvh(args[1])
