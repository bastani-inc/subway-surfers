"""Rig the runner (and guard), retarget CMU motion-capture clips onto them and export animated GLBs.

Run from the repository root:
    blender -b --python scripts/blender/rig_characters.py                 # runner and guard
    blender -b --python scripts/blender/rig_characters.py -- runner       # one character

Inputs
    assets/rig_src/<id>.glb   static cleaned mesh (refreshed from public/models/<id>.glb when that file has no skin)
    assets/mocap/*.bvh        CMU Graphics Lab Motion Capture Database trials (cgspeed BVH conversion, 120 fps)
Outputs
    public/models/<id>.glb    skinned mesh + armature + actions ("run", and for the runner "jump", "roll")
    assets/manifest.json      <id>.rig and <id>.animations (durations, frames, run stride length)
    assets/renders/<id>_rig_poses.png   weight test poses (knee, hip, shoulder)

Conventions match cleanup_models.py: Blender Z up, character faces +Y (glTF -Z), character's right is +X.
"""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = os.getcwd()
MOCAP = os.path.join(ROOT, "assets", "mocap")
SRC_DIR = os.path.join(ROOT, "assets", "rig_src")
OUT_DIR = os.path.join(ROOT, "public", "models")
RENDER_DIR = os.path.join(ROOT, "assets", "renders")
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")
FPS = 60
BVH_FPS = 120

CMU_UNIT_M = 0.0254 / 0.45
MIN_RUN_SPEED = 3.5
MAX_SOURCE_SKATE = 0.15
PLANT_FULL = 0.035
PLANT_NONE = 0.07
RUN_CANDIDATES = ["127_06", "127_07", "127_03", "35_17", "16_35"]

CHARACTERS = {
    "runner": {
        "center": {"hips": (0, 0.0, 0.86), "spine": (0, -0.01, 1.00), "chest": (0, -0.01, 1.15),
                   "neck": (0, -0.01, 1.31), "head": (0, 0.0, 1.38), "head_top": (0, 0.0, 1.66)},
        "right": {"hip": (0.10, 0.0, 0.84), "knee": (0.135, -0.02, 0.55), "ankle": (0.21, -0.06, 0.16),
                  "ball": (0.21, 0.10, 0.05), "toe": (0.21, 0.21, 0.04),
                  "clavicle": (0.03, -0.02, 1.27), "shoulder": (0.15, -0.02, 1.24), "elbow": (0.30, -0.02, 0.98),
                  "wrist": (0.355, 0.02, 0.89), "hand_end": (0.395, 0.04, 0.73)},
        "clips": ["run", "jump", "roll"],
    },
    "guard": {
        "center": {"hips": (0, 0.0, 0.86), "spine": (0, -0.01, 1.02), "chest": (0, -0.01, 1.22),
                   "neck": (0, -0.01, 1.43), "head": (0, 0.0, 1.50), "head_top": (0, 0.0, 1.86)},
        "right": {"hip": (0.09, 0.0, 0.84), "knee": (0.10, -0.03, 0.48), "ankle": (0.125, -0.06, 0.13),
                  "ball": (0.13, 0.08, 0.04), "toe": (0.14, 0.20, 0.03),
                  "clavicle": (0.04, -0.02, 1.38), "shoulder": (0.20, -0.04, 1.36), "elbow": (0.37, -0.05, 1.03),
                  "wrist": (0.42, -0.03, 0.79), "hand_end": (0.45, 0.0, 0.60)},
        "clips": ["run"],
    },
}

SIDES = {"L": ("Left", -1.0), "R": ("Right", 1.0)}
CENTER_BONES = [("Hips", "hips", "spine", None), ("Spine", "spine", "chest", "Hips"),
                ("Chest", "chest", "neck", "Spine"), ("Neck", "neck", "head", "Chest"), ("Head", "head", "head_top", "Neck")]
LIMB_BONES = [("UpperLeg", "hip", "knee", "Hips"), ("LowerLeg", "knee", "ankle", "UpperLeg"),
              ("Foot", "ankle", "ball", "LowerLeg"), ("Toe", "ball", "toe", "Foot"),
              ("Shoulder", "clavicle", "shoulder", "Chest"), ("UpperArm", "shoulder", "elbow", "Shoulder"),
              ("LowerArm", "elbow", "wrist", "UpperArm"), ("Hand", "wrist", "hand_end", "LowerArm")]
LEG_PARTS = ("UpperLeg", "LowerLeg", "Foot", "Toe")
ARM_PARTS = ("Shoulder", "UpperArm", "LowerArm", "Hand")

# target bone -> (source bone whose world rotation drives it, source direction joints for rest alignment)
CENTER_MAP = {"Hips": ("Hips", None), "Spine": ("LowerBack", ("LowerBack", "Spine")),
              "Chest": ("Spine", ("Spine", "Neck")), "Neck": ("Neck", ("Neck", "Head")),
              "Head": ("Head", ("Head", "Head:tail"))}
LIMB_MAP = {"UpperLeg": ("{s}UpLeg", ("{s}UpLeg", "{s}Leg")), "LowerLeg": ("{s}Leg", ("{s}Leg", "{s}Foot")),
            "Foot": ("{s}Foot", ("{s}Foot", "{s}ToeBase")), "Toe": ("{s}ToeBase", ("{s}ToeBase", "{s}ToeBase:tail")),
            "Shoulder": ("{s}Shoulder", ("{s}Shoulder", "{s}Arm")), "UpperArm": ("{s}Arm", ("{s}Arm", "{s}ForeArm")),
            "LowerArm": ("{s}ForeArm", ("{s}ForeArm", "{s}Hand")), "Hand": ("{s}Hand", ("{s}ForeArm", "{s}Hand"))}


def log(msg):
    print(f"[rig] {msg}", flush=True)


def target_bone_order():
    order = [c[0] for c in CENTER_BONES]
    for side in SIDES:
        order += [f"{part}.{side}" for part, *_ in LIMB_BONES]
    return order


def bone_mapping():
    mapping = {}
    for name, (src, dirs) in CENTER_MAP.items():
        mapping[name] = (src, dirs, None)
    for side, (word, _) in SIDES.items():
        for part, (src, dirs) in LIMB_MAP.items():
            mapping[f"{part}.{side}"] = (src.format(s=word), tuple(d.format(s=word) for d in dirs), None)
    mapping["Hand.L"] = (mapping["Hand.L"][0], mapping["Hand.L"][1], ("elbow", "wrist"))
    mapping["Hand.R"] = (mapping["Hand.R"][0], mapping["Hand.R"][1], ("elbow", "wrist"))
    return mapping


# ---------------------------------------------------------------- mesh + armature

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def has_skin(path):
    with open(path, "rb") as fh:
        data = fh.read()
    length = int.from_bytes(data[12:16], "little")
    doc = json.loads(data[20:20 + length])
    return bool(doc.get("skins"))


def load_static_mesh(cid):
    public = os.path.join(OUT_DIR, f"{cid}.glb")
    src = os.path.join(SRC_DIR, f"{cid}.glb")
    os.makedirs(SRC_DIR, exist_ok=True)
    if os.path.exists(public) and not has_skin(public):
        with open(public, "rb") as a, open(src, "wb") as b:
            b.write(a.read())
        log(f"{cid}: refreshed static source from {public}")
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"{cid}: expected one mesh, found {len(meshes)}")
    mesh = meshes[0]
    world = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = world
    for o in list(bpy.context.scene.objects):
        if o is not mesh:
            bpy.data.objects.remove(o)
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.name = cid
    return mesh


def refine_joints(mesh, cfg):
    """Center limb joints in the mesh cross-section around each hand-placed landmark."""
    co = np.array([v.co[:] for v in mesh.data.vertices])
    joints = {k: Vector(v) for k, v in cfg["center"].items()}
    for side, (_, sign) in SIDES.items():
        for name, p in cfg["right"].items():
            joints[f"{name}.{side}"] = Vector((p[0] * sign, p[1], p[2]))
    for side, (_, sign) in SIDES.items():
        on_side = co[:, 0] * sign > 0.02
        for name in ("knee", "ankle"):
            p = joints[f"{name}.{side}"]
            sel = on_side & (np.abs(co[:, 2] - p.z) < 0.015)
            c = co[sel].mean(axis=0)
            joints[f"{name}.{side}"] = Vector((c[0], c[1], p.z))
        for name in ("elbow", "wrist"):
            p = joints[f"{name}.{side}"]
            for _ in range(3):
                sel = on_side & (np.linalg.norm(co - np.array(p[:]), axis=1) < 0.045)
                if sel.sum() < 10:
                    break
                p = Vector(co[sel].mean(axis=0))
            joints[f"{name}.{side}"] = p
    return joints


def build_armature(cid, mesh, joints):
    arm_data = bpy.data.armatures.new(f"{cid}_rig")
    arm = bpy.data.objects.new(f"{cid}_rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def add(name, head, tail, parent, connect=False):
        b = eb.new(name)
        b.head, b.tail = head, tail
        b.roll = 0.0
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    for name, h, t, parent in CENTER_BONES:
        add(name, joints[h], joints[t], parent, connect=parent not in (None, "Hips") and name != "Spine")
    for side in SIDES:
        for part, h, t, parent in LIMB_BONES:
            par = parent if parent in ("Hips", "Chest") else f"{parent}.{side}"
            add(f"{part}.{side}", joints[f"{h}.{side}"], joints[f"{t}.{side}"], par,
                connect=parent not in ("Hips", "Chest"))
    for b in eb:
        if b.name.startswith(("Foot", "Toe")):
            b.align_roll(Vector((0, 0, 1)))
        elif b.name.startswith(("UpperArm", "LowerArm", "Hand", "Shoulder")):
            b.align_roll(Vector((0, -1, 0)))
        else:
            b.align_roll(Vector((0, 1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def bind(mesh, arm):
    """Bone-heat weights solved on a welded proxy at 10x scale, cleaned there, then copied to the render mesh.

    The glTF mesh is split at UV seams (751 islands), which makes the heat solver fail; welding restores
    connectivity, and cleaning on the welded proxy keeps coincident seam vertices identical so seams never tear.
    """
    import bmesh
    from mathutils.kdtree import KDTree

    scale = 10.0
    proxy = mesh.copy()
    proxy.data = mesh.data.copy()
    proxy.name = f"{mesh.name}_proxy"
    bpy.context.scene.collection.objects.link(proxy)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bm.to_mesh(proxy.data)
    bm.free()
    tmp_arm = arm.copy()
    tmp_arm.data = arm.data.copy()
    bpy.context.scene.collection.objects.link(tmp_arm)
    for o in (proxy, tmp_arm):
        o.scale = (scale, scale, scale)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (proxy, tmp_arm):
        o.select_set(True)
    bpy.context.view_layer.objects.active = tmp_arm
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    tmp_arm.select_set(True)
    bpy.context.view_layer.objects.active = tmp_arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    proxy.modifiers.clear()
    proxy.parent = None
    proxy.data.transform(Matrix.Scale(1.0 / scale, 4))
    proxy.matrix_world = Matrix()
    w, names = fix_weights(proxy, arm)

    tree = KDTree(len(proxy.data.vertices))
    for v in proxy.data.vertices:
        tree.insert(v.co, v.index)
    tree.balance()
    src_index = [tree.find(v.co)[1] for v in mesh.data.vertices]
    worst = max(tree.find(v.co)[2] for v in mesh.data.vertices)
    mw = w[src_index]
    for n in names:
        g = mesh.vertex_groups.new(name=n)
        j = names.index(n)
        for vi in np.nonzero(mw[:, j])[0]:
            g.add([int(vi)], float(mw[vi, j]), "REPLACE")
    for o in (proxy, tmp_arm):
        data = o.data
        bpy.data.objects.remove(o)
        if isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
        else:
            bpy.data.armatures.remove(data)
    mesh.parent = arm
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    log(f"{mesh.name}: weights copied from welded proxy ({len(w)} verts) to {len(mw)} render verts, max match distance {worst:.2e} m")


def segment_distance(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def fix_weights(mesh, arm):
    """Clean automatic weights: no cross-body bleed, every vertex weighted, smoothed joints, <=4 influences."""
    names = [b.name for b in arm.data.bones]
    groups = {g.name: g for g in mesh.vertex_groups}
    for n in names:
        if n not in groups:
            groups[n] = mesh.vertex_groups.new(name=n)
    nv = len(mesh.data.vertices)
    idx_of = {g.index: g.name for g in mesh.vertex_groups}
    w = np.zeros((nv, len(names)))
    col = {n: i for i, n in enumerate(names)}
    for v in mesh.data.vertices:
        for g in v.groups:
            n = idx_of.get(g.group)
            if n in col:
                w[v.index, col[n]] = g.weight
    co = np.array([v.co[:] for v in mesh.data.vertices])
    unweighted_before = int((w.sum(axis=1) < 1e-4).sum())

    bones = {b.name: (np.array(b.head_local[:]), np.array(b.tail_local[:])) for b in arm.data.bones}
    dist = np.stack([segment_distance(co, *bones[n]) for n in names], axis=1)
    crotch = min(bones["UpperLeg.L"][0][2], bones["UpperLeg.R"][0][2])
    armpit = min(bones["UpperArm.L"][0][2], bones["UpperArm.R"][0][2])
    shoulder_x = min(abs(bones["UpperArm.L"][0][0]), abs(bones["UpperArm.R"][0][0]))

    cross = np.zeros_like(w, dtype=bool)
    region = np.zeros_like(w, dtype=bool)
    for side, (_, sign) in SIDES.items():
        for part in LEG_PARTS + ARM_PARTS:
            cross[:, col[f"{part}.{side}"]] |= co[:, 0] * sign < -0.005
        for part in LEG_PARTS:
            region[:, col[f"{part}.{side}"]] |= co[:, 2] > crotch + 0.18
        for part in ("UpperArm", "LowerArm", "Hand"):
            # torso and legs never follow the arms: inside the shoulder line and below the armpit
            region[:, col[f"{part}.{side}"]] |= (np.abs(co[:, 0]) < shoulder_x - 0.03) & (co[:, 2] < armpit - 0.02)
            region[:, col[f"{part}.{side}"]] |= co[:, 2] < crotch - 0.15
    for part in ("LowerLeg", "Foot", "Toe"):
        for side in SIDES:
            region[:, col[f"{part}.{side}"]] |= co[:, 2] > crotch - 0.05
    forbid = cross | region
    leaked_per_vert = (w * forbid).sum(axis=1)
    leaked = float(leaked_per_vert.sum())
    w[forbid] = 0.0

    empty = w.sum(axis=1) < 1e-4
    d = np.where(forbid, np.inf, dist)
    nearest = d.argmin(axis=1)
    w[empty, nearest[empty]] = 1.0

    # Smooth across the mesh graph near the hip, knee and shoulder joints, where heat weights crease, and
    # around every vertex that lost leaked weight so the cleanup leaves no hard step. Cross-body weights
    # stay zero; region cut-offs may soften back by a few percent at their border.
    edges = np.array([e.vertices[:] for e in mesh.data.edges])
    joint_pts = [bones[f"{p}.{s}"][0] for p in ("UpperLeg", "LowerLeg", "UpperArm", "Shoulder") for s in SIDES]
    near = np.min(np.stack([np.linalg.norm(co - j, axis=1) for j in joint_pts], axis=1), axis=1) < 0.14
    touched = leaked_per_vert > 1e-3
    for _ in range(3):
        grown = touched.copy()
        grown[edges[touched[edges[:, 0]], 1]] = True
        grown[edges[touched[edges[:, 1]], 0]] = True
        touched = grown
    near |= touched
    deg = np.bincount(edges.ravel(), minlength=nv).astype(float)
    for _ in range(8):
        acc = np.zeros_like(w)
        np.add.at(acc, edges[:, 0], w[edges[:, 1]])
        np.add.at(acc, edges[:, 1], w[edges[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        w[near] = 0.5 * w[near] + 0.5 * avg[near]
        w[cross] = 0.0

    # Keep the four strongest influences (glTF skin limit) and normalize.
    order = np.argsort(-w, axis=1)
    keep = np.zeros_like(w, dtype=bool)
    np.put_along_axis(keep, order[:, :4], True, axis=1)
    w[~keep] = 0.0
    w[w < 0.01] = 0.0
    total = w.sum(axis=1)
    w[total < 1e-6, 0] = 1.0
    w /= w.sum(axis=1, keepdims=True)

    log(f"{mesh.name}: weights: {unweighted_before} verts unweighted by heat solver, removed {leaked:.1f} "
        f"weight from forbidden bones, smoothed {int(near.sum())} joint verts, max influences 4")
    return w, names


# ---------------------------------------------------------------- weight test poses

def deformed_coords(mesh):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    m = ev.to_mesh()
    out = np.array([v.co[:] for v in m.vertices])
    ev.to_mesh_clear()
    return out


TEST_POSES = {
    "knee_bend_90": ({"UpperLeg.R": ("X", 60), "LowerLeg.R": ("X", -90)}, "knee.R", (1.0, 0.25, 0.1)),
    "hip_flex_80": ({"UpperLeg.L": ("X", 80)}, "hips", (-0.6, 1.0, 0.1)),
    "hip_extend_30": ({"UpperLeg.L": ("X", -30)}, "hips", (-1.0, -0.5, 0.1)),
    "arm_forward_70": ({"UpperArm.R": ("X", 70), "LowerArm.R": ("X", 60)}, "shoulder.R", (1.0, 0.6, 0.2)),
    "arm_back_45": ({"UpperArm.L": ("X", -45)}, "shoulder.L", (-1.0, -0.4, 0.2)),
    "shoulder_raise_60": ({"UpperArm.R": ("Y", -60)}, "shoulder.R", (0.4, 1.0, 0.1)),
}


def world_axis_pose(arm, pose):
    """Apply rotations about world axes (degrees) to listed bones, parent first."""
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
    bpy.context.view_layer.update()
    for bone, (axis, deg) in pose.items():
        pb = arm.pose.bones[bone]
        axis_v = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}[axis]
        if bone.endswith(".L") and axis != "X":
            deg = -deg
        world = pb.matrix.to_quaternion()
        target = Quaternion(axis_v, math.radians(deg)) @ world
        rest = pb.bone.matrix_local.to_quaternion()
        parent_world = pb.parent.matrix.to_quaternion() if pb.parent else Quaternion()
        parent_rest = pb.parent.bone.matrix_local.to_quaternion() if pb.parent else Quaternion()
        pb.rotation_quaternion = (parent_rest.inverted() @ rest).inverted() @ parent_world.inverted() @ target
        bpy.context.view_layer.update()


def weight_report(cid, mesh, arm):
    rest = deformed_coords(mesh)
    edges = np.array([e.vertices[:] for e in mesh.data.edges])
    rest_len = np.linalg.norm(rest[edges[:, 0]] - rest[edges[:, 1]], axis=1)
    report = {}
    for name, (pose, _, _) in TEST_POSES.items():
        world_axis_pose(arm, pose)
        cur = deformed_coords(mesh)
        ratio = np.linalg.norm(cur[edges[:, 0]] - cur[edges[:, 1]], axis=1) / np.maximum(rest_len, 1e-6)
        moved = np.linalg.norm(cur - rest, axis=1) > 1e-4
        sel = moved[edges[:, 0]] | moved[edges[:, 1]]
        r = ratio[sel]
        worst = edges[sel][int(r.argmax())]
        report[name] = {"p99_stretch": round(float(np.percentile(r, 99)), 3), "p1_squash": round(float(np.percentile(r, 1)), 3),
                        "max": round(float(r.max()), 2), "edges": int(sel.sum()),
                        "worst_at": [round(float(c), 3) for c in rest[worst[0]]]}
        log(f"{cid}: pose {name}: {report[name]}")
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
    return report


def render_test_poses(cid, mesh, arm, joints):
    """Close-ups of each weight test pose next to the same view at rest."""
    sc = bpy.context.scene
    setup_render(sc, 512, 512)
    cam = sc.camera
    tiles = []
    for name, (pose, focus, view) in TEST_POSES.items():
        target = joints[focus]
        loc = target + Vector(view).normalized() * 1.0
        cam.location = loc
        cam.rotation_euler = (target - loc).to_track_quat("-Z", "Y").to_euler()
        for label, p in (("rest", {}), ("posed", pose)):
            world_axis_pose(arm, p)
            path = f"/tmp/{cid}_pose_{name}_{label}.png"
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True)
            tiles.append(path)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
    stitch(tiles, cols=len(TEST_POSES), rows=2, out=os.path.join(RENDER_DIR, f"{cid}_rig_poses.png"), order="column")
    cleanup_render_scene(sc)


def setup_render(sc, w, h):
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.66, 0.74, 1)
    sc.world = world
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "render_ground"
    mat = bpy.data.materials.new("render_ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.52, 0.56, 1)
    ground.data.materials.append(mat)
    sun = bpy.data.objects.new("render_sun", bpy.data.lights.new("render_sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(35), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("render_cam", bpy.data.cameras.new("render_cam"))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam


def cleanup_render_scene(sc):
    for o in list(sc.objects):
        if o.name.startswith("render_"):
            bpy.data.objects.remove(o)


def stitch(paths, cols, rows, out, order="row"):
    imgs = []
    for p in paths:
        im = bpy.data.images.load(p)
        w, h = im.size
        imgs.append(np.array(im.pixels[:]).reshape(h, w, 4))
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    canvas = np.ones((rows * h, cols * w, 4))
    for i, a in enumerate(imgs):
        r, c = (i % rows, i // rows) if order == "column" else (i // cols, i % cols)
        canvas[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = a
    img = bpy.data.images.new("stitch", cols * w, rows * h, alpha=True)
    img.pixels = canvas.ravel()
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


# ---------------------------------------------------------------- motion capture

class Source:
    """An imported BVH, rotated so the chosen segment's travel direction is +Y."""

    def __init__(self, take):
        before = set(bpy.data.objects)
        bpy.ops.import_anim.bvh(filepath=os.path.join(MOCAP, f"{take}.bvh"), global_scale=1.0, use_fps_scale=False,
                                update_scene_fps=False, update_scene_duration=False, rotate_mode="NATIVE")
        self.obj = next(o for o in bpy.data.objects if o not in before)
        self.obj.name = f"bvh_{take}"
        self.take = take
        self.action = self.obj.animation_data.action
        self.first, self.last = (int(round(v)) for v in self.action.frame_range)
        self.rest_head = {b.name: b.head_local.copy() for b in self.obj.data.bones}
        self.rest_tail = {b.name: b.tail_local.copy() for b in self.obj.data.bones}
        rh = self.rest_head
        self.leg = (rh["LeftUpLeg"] - rh["LeftLeg"]).length + (rh["LeftLeg"] - rh["LeftFoot"]).length

    def set_frame(self, f):
        sc = bpy.context.scene
        whole = math.floor(f)
        sc.frame_set(whole, subframe=f - whole)

    def joint(self, name):
        mw = self.obj.matrix_world
        if name.endswith(":tail"):
            return mw @ self.obj.pose.bones[name[:-5]].tail
        return mw @ self.obj.pose.bones[name].head

    def rest_joint(self, name):
        mw = self.obj.matrix_world
        return mw @ (self.rest_tail[name[:-5]] if name.endswith(":tail") else self.rest_head[name])

    def hip_mid(self):
        return (self.joint("LeftUpLeg") + self.joint("RightUpLeg")) / 2

    def world_rot(self, name):
        return (self.obj.matrix_world @ self.obj.pose.bones[name].matrix).to_quaternion()

    def rest_rot(self, name):
        return (self.obj.matrix_world @ self.obj.data.bones[name].matrix_local).to_quaternion()

    def rest_facing(self):
        right = self.rest_joint("RightUpLeg") - self.rest_joint("LeftUpLeg")
        f = Vector((0, 0, 1)).cross(right)
        f.z = 0
        return f.normalized()

    def face_travel(self, f0, f1):
        self.obj.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        self.set_frame(f0)
        a = self.hip_mid()
        self.set_frame(f1)
        d = self.hip_mid() - a
        yaw = math.atan2(d.y, d.x)
        self.obj.rotation_euler = (0, 0, math.pi / 2 - yaw)
        bpy.context.view_layer.update()

    def features(self):
        bones = ["LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg", "LeftArm", "RightArm", "LeftForeArm",
                 "RightForeArm", "LowerBack", "LeftFoot", "RightFoot"]
        rows, self.hip_track = [], []
        for f in range(self.first, self.last + 1):
            bpy.context.scene.frame_set(f)
            self.hip_track.append(self.hip_mid()[:])
            q = []
            for b in bones:
                v = self.obj.pose.bones[b].matrix_basis.to_quaternion()
                q.extend(v if v.w >= 0 else -v)
            rows.append(q)
        return np.array(rows)


def find_loop(src, min_len=56, max_len=110):
    """Best single gait cycle: start and end pose and velocity match."""
    feat = src.features()
    hip = np.array(src.hip_track)
    n = len(feat)
    vel = np.vstack([feat[1:] - feat[:-1], feat[-1:] - feat[-2:-1]])
    best = None
    margin = 8
    for i in range(margin, n - min_len - 2):
        for length in range(min_len, max_len + 1):
            j = i + length
            if j >= n - 2:
                break
            speed = np.linalg.norm(hip[j, :2] - hip[i, :2]) * CMU_UNIT_M / (length / BVH_FPS)
            if speed < MIN_RUN_SPEED:
                continue
            cost = np.abs(feat[i] - feat[j]).sum() + 4.0 * np.abs(vel[i] - vel[j]).sum()
            if best is None or cost < best[0]:
                best = (cost, i, j)
    if best is None:
        return None
    cost, i, j = best
    return src.first + i, src.first + j, cost


# ---------------------------------------------------------------- retargeting

def shortest_arc(a, b):
    a, b = a.normalized(), b.normalized()
    return a.rotation_difference(b)


class Retargeter:
    def __init__(self, src, arm, joints):
        self.src, self.arm, self.joints = src, arm, joints
        self.order = target_bone_order()
        self.mapping = bone_mapping()
        bpy.context.scene.frame_set(src.first)
        tl = {b.name: b for b in arm.data.bones}
        self.t_rest = {n: tl[n].matrix_local.to_quaternion() for n in self.order}
        self.parent = {n: (tl[n].parent.name if tl[n].parent else None) for n in self.order}
        self.t_head = {n: tl[n].head_local.copy() for n in self.order}
        t_leg = (tl["UpperLeg.L"].head_local - tl["LowerLeg.L"].head_local).length + \
                (tl["LowerLeg.L"].head_local - tl["Foot.L"].head_local).length
        self.k = t_leg / src.leg
        self.t_hipmid = (tl["UpperLeg.L"].head_local + tl["UpperLeg.R"].head_local) / 2
        self.sole = None
        self.update_alignment()

    def update_alignment(self):
        src = self.src
        bpy.context.view_layer.update()
        facing = src.rest_facing()
        q0 = Vector((0, 1, 0)).rotation_difference(facing)
        tl = self.arm.data.bones
        self.q = {}
        for n in self.order:
            src_bone, dirs, tdirs = self.mapping[n]
            if dirs is None:
                self.q[n] = q0
                continue
            s_dir = src.rest_joint(dirs[1]) - src.rest_joint(dirs[0])
            if tdirs:
                side = n[-1]
                t_dir = self.joints[f"{tdirs[1]}.{side}"] - self.joints[f"{tdirs[0]}.{side}"]
            else:
                t_dir = tl[n].tail_local - tl[n].head_local
            self.q[n] = shortest_arc(q0 @ t_dir, s_dir) @ q0

    def sample(self, f):
        """Target world rotations per bone and source hip-mid position (source units) at source frame f."""
        self.src.set_frame(f)
        rots = {}
        for n in self.order:
            sb = self.mapping[n][0]
            d = self.src.world_rot(sb) @ self.src.rest_rot(sb).inverted()
            rots[n] = d @ self.q[n] @ self.t_rest[n]
        ankles = {s: self.src.joint(f"{word}Foot").copy() for s, (word, _) in SIDES.items()}
        return rots, self.src.hip_mid().copy(), ankles

    def hips_head(self, rots, hip_mid):
        """World position of the Hips bone head when the hip-joint midpoint sits at hip_mid."""
        offset = self.t_rest["Hips"].inverted() @ (self.t_head["Hips"] - self.t_hipmid)
        return hip_mid + rots["Hips"] @ offset

    def fk_head(self, rots, root, name):
        chain = []
        n = name
        while n is not None:
            chain.append(n)
            n = self.parent[n]
        pos = root.copy()
        for parent, child in zip(reversed(chain), list(reversed(chain))[1:]):
            pos = pos + rots[parent] @ (self.t_rest[parent].inverted() @ (self.t_head[child] - self.t_head[parent]))
        return pos

    def leg_ik(self, rots, root, side, ankle_goal):
        """Two-bone IK: put the ankle on ankle_goal, keeping the FK knee plane and the foot's world rotation."""
        up, low = f"UpperLeg.{side}", f"LowerLeg.{side}"
        hip = self.fk_head(rots, root, up)
        knee = self.fk_head(rots, root, low)
        ankle = self.fk_head(rots, root, f"Foot.{side}")
        l1 = (self.t_head[low] - self.t_head[up]).length
        l2 = (self.t_head[f"Foot.{side}"] - self.t_head[low]).length
        d = ankle_goal - hip
        dist = min(max(d.length, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995)
        axis = d.normalized()
        pole = (knee - hip) - axis * (knee - hip).dot(axis)
        if pole.length < 1e-6:
            pole = Vector((0, 1, 0)) - axis * axis.y
        pole.normalize()
        a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
        h = math.sqrt(max(l1 * l1 - a * a, 0.0))
        knee_new = hip + axis * a + pole * h
        ankle_new = hip + axis * dist
        r_up = (knee - hip).rotation_difference(knee_new - hip)
        r_low = (r_up @ (ankle - knee)).rotation_difference(ankle_new - knee_new)
        rots[up] = r_up @ rots[up]
        rots[low] = r_low @ r_up @ rots[low]
        return (ankle_new - ankle_goal).length

    def sole_offset(self, rots, side):
        """Lowest shoe point relative to the ankle (z), for the foot and toe world rotations in rots."""
        foot, toe = f"Foot.{side}", f"Toe.{side}"
        foot_pts, toe_pts = self.sole[side]
        rf = rots[foot] @ self.t_rest[foot].inverted()
        rt = rots[toe] @ self.t_rest[toe].inverted()
        toe_head = rf @ (self.t_head[toe] - self.t_head[foot])
        low = min((rf @ (p - self.t_head[foot])).z for p in foot_pts)
        if toe_pts:
            low = min(low, min((toe_head + rt @ (p - self.t_head[toe])).z for p in toe_pts))
        return low

    def to_local(self, rots):
        local = {}
        for n in self.order:
            p = self.parent[n]
            if p is None:
                local[n] = self.t_rest[n].inverted() @ rots[n]
            else:
                rel = self.t_rest[p].inverted() @ self.t_rest[n]
                local[n] = rel.inverted() @ rots[p].inverted() @ rots[n]
            local[n].normalize()
        return local

    def root_location(self, rots_root, hip_target):
        # Hips head sits at the hip-joint midpoint, so its pose location is just the head offset in rest space.
        return self.t_rest["Hips"].inverted() @ (hip_target - self.t_head["Hips"])


def keyframes(arm, action_name, frames):
    """frames: list of (root_loc Vector, {bone: Quaternion}) at FPS, keyed at 0..n-1."""
    if action_name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[action_name])
    arm.animation_data_create()
    action = bpy.data.actions.new(action_name)
    action.use_fake_user = True
    arm.animation_data.action = action
    prev = {}
    for i, (loc, local) in enumerate(frames):
        for n, q in local.items():
            if n in prev and prev[n].dot(q) < 0:
                q = -q
            prev[n] = q
            pb = arm.pose.bones[n]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=i, group=n)
        hips = arm.pose.bones["Hips"]
        hips.location = loc
        hips.keyframe_insert("location", frame=i, group="Hips")
    return action


def close_loop(frames):
    """Distribute the end-start mismatch over the loop so the last frame equals the first."""
    n = len(frames) - 1
    loc0, rot0 = frames[0]
    locn, rotn = frames[-1]
    out = []
    for i, (loc, local) in enumerate(frames):
        t = i / n
        fixed = {}
        for b, q in local.items():
            q0, qn = rot0[b], rotn[b]
            if q0.dot(qn) < 0:
                qn = -qn
            corr = Quaternion().slerp(q0 @ qn.inverted(), t)
            fixed[b] = (corr @ q).normalized()
        out.append((loc + (loc0 - locn) * t, fixed))
    out[-1] = (out[0][0].copy(), {b: q.copy() for b, q in out[0][1].items()})
    return out


def mesh_min_z(mesh, arm, n_frames, vert_mask=None):
    sc = bpy.context.scene
    lows = []
    for i in range(n_frames):
        sc.frame_set(i)
        co = deformed_coords(mesh)
        lows.append(float(co[vert_mask, 2].min() if vert_mask is not None else co[:, 2].min()))
    return np.array(lows)


def shift_root(frames, retarget, dz):
    out = []
    for loc, local in frames:
        world_shift = retarget.t_rest["Hips"].inverted() @ Vector((0, 0, dz))
        out.append((loc + world_shift, local))
    return out


def extract(retarget, f0, f1, mode):
    """Retarget source frames f0..f1 to FPS output frames. mode: run (in-place loop), jump, roll."""
    src = retarget.src
    duration = (f1 - f0) / BVH_FPS
    n = max(2, round(duration * FPS))
    samples = [retarget.sample(f0 + (f1 - f0) * i / n) for i in range(n + 1)]
    hips = [s[1] for s in samples]
    start, end = hips[0], hips[-1]
    frames = []
    ik_err = 0.0
    staged = []
    for i, (rots, hip, ankles) in enumerate(samples):
        t = i / n
        drift = start + (end - start) * t
        rel = hip - drift
        target = Vector((rel.x * retarget.k, rel.y * retarget.k, hip.z * retarget.k)) + \
            Vector((retarget.t_hipmid.x, retarget.t_hipmid.y, 0))
        root = retarget.hips_head(rots, target)
        goals = {}
        for side in SIDES:
            goals[side] = target + (ankles[side] - hip) * retarget.k
            goals[side].x = retarget.fk_head(rots, root, f"Foot.{side}").x
        staged.append((rots, root, goals))
    # The mocap markers sit ~1 cm differently on each foot; give both feet the same lowest ankle height.
    lowest = {s: min(g[s].z for _, _, g in staged) for s in SIDES}
    floor = sum(lowest.values()) / len(lowest)
    for _, _, goals in staged:
        for side in SIDES:
            goals[side].z += floor - lowest[side]
    planted = 0
    if mode == "run" and retarget.sole:
        # Sole height above the floor for each foot, from the shoe's own geometry at the mocap foot angle.
        gaps = [{s: goals[s].z + retarget.sole_offset(rots, s) for s in SIDES} for rots, _, goals in staged]
        lift = -min(g[s] for g in gaps for s in SIDES)
        for (rots, root, goals), gap in zip(staged, gaps):
            root.z += lift
            for side in SIDES:
                goals[side].z += lift
                h = gap[side] + lift
                weight = 1.0 if h <= PLANT_FULL else max(0.0, (PLANT_NONE - h) / (PLANT_NONE - PLANT_FULL))
                if weight > 0:
                    goals[side].z -= h * weight
                    planted += 1
    for rots, root, goals in staged:
        for side in SIDES:
            ik_err = max(ik_err, retarget.leg_ik(rots, root, side, goals[side]))
        frames.append((retarget.root_location(rots["Hips"], root), retarget.to_local(rots)))
    log(f"{src.take} {mode}: leg IK on source ankle paths, max ankle miss {ik_err * 100:.1f} cm (reach clamp), "
        f"foot height equalized by {abs(lowest['L'] - lowest['R']) * 100:.1f} cm, {planted} foot-frames planted")
    travel = (end - start)
    travel.z = 0
    info = {"source": f"CMU {src.take} frames {f0:.0f}-{f1:.0f} at {BVH_FPS} fps", "sourceFrames": [int(f0), int(f1)],
            "sourceDistance_m": round(travel.length * retarget.k, 4), "scale": round(retarget.k, 5),
            "frames": n + 1, "duration": round(n / FPS, 4), "sourceDuration": round(duration, 4)}
    if mode == "run":
        frames = close_loop(frames)
        info["loop"] = True
    return frames, info


def sole_points(mesh, max_z=0.12, stride=3):
    """Rest positions of the shoe vertices skinned mostly to each foot and toe bone."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    out = {s: ([], []) for s in SIDES}
    for v in mesh.data.vertices:
        if v.co.z > max_z or v.index % stride or not v.groups:
            continue
        name = names[max(v.groups, key=lambda g: g.weight).group]
        for side in SIDES:
            if name == f"Foot.{side}":
                out[side][0].append(v.co.copy())
            elif name == f"Toe.{side}":
                out[side][1].append(v.co.copy())
    return out


def source_skate(src, f0, f1):
    """Stance-foot speed relative to the hips' travel speed in the source: ~1 means the mocap foot is planted."""
    ratios = []
    hips = []
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        hips.append(src.hip_mid().copy())
    speed = (hips[-1] - hips[0]).length / ((f1 - f0) / BVH_FPS)
    for word in ("Left", "Right"):
        pts = []
        for f in range(f0, f1 + 1):
            bpy.context.scene.frame_set(f)
            pts.append(src.joint(f"{word}ToeBase").copy())
        z = np.array([p.z for p in pts])
        low = z <= np.percentile(z, 25)
        v = [((pts[i + 1] - pts[i]) * BVH_FPS).length for i in range(len(pts) - 1) if low[i] and low[i + 1]]
        ratios.append(float(np.mean(v)) / speed if v else 1.0)
    return max(ratios)


# ---------------------------------------------------------------- clip selection

def choose_run(arm, joints):
    best = None
    candidates = [os.environ["RIG_RUN_TAKE"]] if os.environ.get("RIG_RUN_TAKE") else RUN_CANDIDATES
    for take in candidates:
        src = Source(take)
        loop = find_loop(src)
        if loop is None:
            log(f"run candidate {take}: no gait cycle at >= {MIN_RUN_SPEED} m/s")
            bpy.data.objects.remove(src.obj)
            continue
        f0, f1, cost = loop
        src.face_travel(f0, f1)
        bpy.context.scene.frame_set(f0)
        a = src.hip_mid().copy()
        bpy.context.scene.frame_set(f1)
        b = src.hip_mid().copy()
        speed = (b - a).length * CMU_UNIT_M / ((f1 - f0) / BVH_FPS)
        skate = source_skate(src, f0, f1)
        log(f"run candidate {take}: loop {f0}-{f1} ({(f1 - f0) / BVH_FPS:.3f} s) mismatch {cost:.3f} speed {speed:.2f} m/s "
            f"stance-toe skate {skate:.2f} x hip speed")
        if skate > MAX_SOURCE_SKATE:
            bpy.data.objects.remove(src.obj)
            continue
        if best is None or cost < best[0]:
            best = (cost, take, f0, f1)
        bpy.data.objects.remove(src.obj)
    return best


def find_jump(src):
    """Takeoff to landing of the running jump, padded with the crouch and the landing absorb."""
    feet, hips = [], []
    for f in range(src.first + 2, src.last + 1):
        bpy.context.scene.frame_set(f)
        feet.append(min(src.joint("LeftToeBase").z, src.joint("RightToeBase").z, src.joint("LeftFoot").z, src.joint("RightFoot").z))
        hips.append(src.hip_mid().z)
    feet, hips = np.array(feet), np.array(hips)
    peak = int(hips.argmax())
    ground = np.percentile(feet, 10)
    airborne = feet > ground + 2.0
    takeoff = peak
    while takeoff > 0 and airborne[takeoff - 1]:
        takeoff -= 1
    landing = peak
    while landing < len(feet) - 1 and airborne[landing + 1]:
        landing += 1
    pad0, pad1 = int(0.16 * BVH_FPS), int(0.2 * BVH_FPS)
    f0 = src.first + 2 + max(0, takeoff - pad0)
    f1 = src.first + 2 + min(len(feet) - 1, landing + pad1)
    return f0, f1, src.first + 2 + takeoff, src.first + 2 + landing


def find_roll(src):
    """From the head dropping toward the floor to the body upright again after the forward roll."""
    rows = []
    for f in range(src.first + 2, src.last + 1):
        bpy.context.scene.frame_set(f)
        up = src.obj.matrix_world.to_3x3() @ src.obj.pose.bones["LowerBack"].matrix.to_3x3() @ Vector((0, 1, 0))
        rows.append((f, src.joint("Head").z, src.hip_mid().z, up.z))
    stand_head = np.median([r[1] for r in rows[:20]])
    stand_hip = np.median([r[2] for r in rows[:20]])
    low = min(range(len(rows)), key=lambda i: rows[i][2])
    start = next(i for i in range(len(rows)) if rows[i][1] < 0.35 * stand_head)
    end = next(i for i in range(low, len(rows)) if rows[i][2] > 0.9 * stand_hip and rows[i][3] > 0.5)
    return rows[start][0], rows[end][0]


# ---------------------------------------------------------------- export + manifest

def export(cid, mesh, arm):
    for a in list(bpy.data.actions):
        if a.name not in ("run", "jump", "roll"):
            bpy.data.actions.remove(a)
    arm.animation_data.action = bpy.data.actions["run"]
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    out = os.path.join(OUT_DIR, f"{cid}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, use_selection=True,
        export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=90,
        export_normals=True, export_texcoords=True, export_skins=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_range=False,
        export_anim_single_armature=True, export_reset_pose_bones=True, export_def_bones=False,
        export_optimize_animation_size=False, export_apply=False,
    )
    log(f"{cid}: exported {out}")
    return out


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ids = argv or list(CHARACTERS)
    with open(MANIFEST) as fh:
        manifest = json.load(fh)
    run_choice = None
    for cid in ids:
        cfg = CHARACTERS[cid]
        reset_scene()
        mesh = load_static_mesh(cid)
        joints = refine_joints(mesh, cfg)
        arm = build_armature(cid, mesh, joints)
        bind(mesh, arm)
        report = weight_report(cid, mesh, arm)
        render_test_poses(cid, mesh, arm, joints)
        if os.environ.get("RIG_WEIGHTS_ONLY"):
            continue

        if run_choice is None:
            run_choice = choose_run(arm, joints)
            log(f"run source: CMU {run_choice[1]} frames {run_choice[2]}-{run_choice[3]}")
        _, take, f0, f1 = run_choice
        clips = {}
        sole = {}
        co_rest = np.array([v.co[:] for v in mesh.data.vertices])
        sole_mask = co_rest[:, 2] < 0.06

        src = Source(take)
        src.face_travel(f0, f1)
        rt = Retargeter(src, arm, joints)
        rt.sole = sole_points(mesh)
        frames, info = extract(rt, f0, f1, "run")
        keyframes(arm, "run", frames)
        lows = mesh_min_z(mesh, arm, len(frames), sole_mask)
        frames = shift_root(frames, rt, -float(lows.min()))
        keyframes(arm, "run", frames)
        info["strideLength"] = info.pop("sourceDistance_m")
        info["sourceSpeed_mps"] = round(info["strideLength"] / info["sourceDuration"], 4)
        info["groundSpeed_mps"] = round(info["strideLength"] / info["duration"], 4)
        clips["run"] = info
        bpy.data.objects.remove(src.obj)

        if "jump" in cfg["clips"]:
            src = Source("127_25")
            j0, j1, takeoff, landing = find_jump(src)
            src.face_travel(j0, j1)
            rt = Retargeter(src, arm, joints)
            frames, info = extract(rt, j0, j1, "jump")
            keyframes(arm, "jump", frames)
            lows = mesh_min_z(mesh, arm, len(frames))
            frames = [(loc + rt.t_rest["Hips"].inverted() @ Vector((0, 0, -float(lo))), local)
                      for (loc, local), lo in zip(frames, lows)]
            keyframes(arm, "jump", frames)
            info["takeoffTime"] = round((takeoff - j0) / BVH_FPS * (info["duration"] / info["sourceDuration"]), 4)
            info["landingTime"] = round((landing - j0) / BVH_FPS * (info["duration"] / info["sourceDuration"]), 4)
            info["note"] = "in place, lowest point pinned to y=0 every frame; the game supplies the jump arc"
            clips["jump"] = info
            bpy.data.objects.remove(src.obj)

        if "roll" in cfg["clips"]:
            src = Source("127_23")
            r0, r1 = find_roll(src)
            src.face_travel(r0, r1)
            rt = Retargeter(src, arm, joints)
            frames, info = extract(rt, r0, r1, "roll")
            keyframes(arm, "roll", frames)
            lows = mesh_min_z(mesh, arm, len(frames))
            frames = shift_root(frames, rt, -float(lows.min()))
            keyframes(arm, "roll", frames)
            info["note"] = "forward dive roll at ground level, forward travel removed, recovers to standing"
            clips["roll"] = info
            bpy.data.objects.remove(src.obj)

        for c in clips.values():
            c.pop("sourceDistance_m", None)
        export(cid, mesh, arm)
        entry = manifest[cid]
        entry["rig"] = {"bones": target_bone_order(), "root": "Hips", "skinned": True,
                        "joints": {k: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)] for k, v in joints.items()},
                        "weightTest": report}
        entry["animations"] = {"fps": FPS, "clips": clips}
        if "run" in clips:
            entry["animations"]["runStrideLength"] = clips["run"]["strideLength"]
        log(f"{cid}: clips {json.dumps(clips, indent=1)}")
    with open(MANIFEST, "w") as fh:
        json.dump({k: manifest[k] for k in sorted(manifest)}, fh, indent=2)
        fh.write("\n")
    log("manifest updated")


main()
