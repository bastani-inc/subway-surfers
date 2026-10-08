"""Independent check of the rigged, animated character GLBs against assets/manifest.json.

    blender -b --python scripts/blender/verify_rig.py                 # runner and guard
    blender -b --python scripts/blender/verify_rig.py -- runner

For the run loop it re-imports the exported GLB and samples every frame:
  * each foot's lowest sole point (mesh vertices skinned mostly to Foot/Toe) and lowest foot-bone point,
  * stance phases (sole within 3 cm of the ground) per foot: one contiguous phase per foot per loop, alternating,
  * arm swing opposite to the legs (hand vs same-side foot fore-aft correlation),
  * root forward translation removed, vertical bob kept, loop seamless,
  * stride: stance-foot backward speed x loop duration vs the manifest stride length; world-space foot slide.
Renders assets/renders/<id>_run_strip.png (8 frames, side view, contact markers: green = left foot, red = right).
Writes the measurements to assets/renders/<id>_run_check.json and exits non-zero on failure.
"""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.getcwd()
CONTACT = 0.03
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
with open(os.path.join(ROOT, "assets", "manifest.json")) as fh:
    manifest = json.load(fh)
ids = argv or [k for k, v in manifest.items() if "animations" in v]


def log(msg):
    print(f"[verify-rig] {msg}", flush=True)


def runs(mask):
    """Contiguous True runs in a cyclic boolean array -> list of (start, length)."""
    n = len(mask)
    if mask.all():
        return [(0, n)]
    if not mask.any():
        return []
    start = int(np.argmin(mask))
    out, i = [], 0
    while i < n:
        j = (start + i) % n
        if mask[j]:
            k = i
            while k < n and mask[(start + k) % n]:
                k += 1
            out.append(((start + i) % n, k - i))
            i = k
        else:
            i += 1
    return out


def deformed(mesh):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    m = ev.to_mesh()
    co = np.array([(ev.matrix_world @ v.co)[:] for v in m.vertices])
    ev.to_mesh_clear()
    return co


def check(cid):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    entry = manifest[cid]
    anim = entry["animations"]
    bpy.context.scene.render.fps = anim["fps"]
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, entry["file"]))
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.type == "ARMATURE")
    mesh = next(o for o in sc.objects if o.type == "MESH")
    actions = {a.name: a for a in bpy.data.actions}
    problems = []
    found = sorted(actions)
    for clip in anim["clips"]:
        if not any(n == clip or n.startswith(clip + "_") for n in found):
            problems.append(f"clip {clip} missing from GLB (found {found})")
    extra = [n for n in found if not any(n == c or n.startswith(c + "_") for c in anim["clips"])]
    if extra:
        problems.append(f"unexpected animations in GLB: {extra}")
    log(f"{cid}: GLB actions {found}")

    run_name = next(n for n in found if n == "run" or n.startswith("run_"))
    arm.animation_data.action = actions[run_name]
    fps = anim["fps"]
    sc.render.fps = fps
    f_start, f_end = (int(round(v)) for v in actions[run_name].frame_range)
    n = f_end - f_start
    clip = anim["clips"]["run"]
    duration = n / fps
    if abs(duration - clip["duration"]) > 1e-3:
        problems.append(f"run duration {duration:.4f} != manifest {clip['duration']}")

    groups = {g.index: g.name for g in mesh.vertex_groups}
    dominant = []
    for v in mesh.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        dominant.append(groups[best.group] if best else "")
    dominant = np.array(dominant)
    sole = {s: np.isin(dominant, [f"Foot.{s}", f"Toe.{s}"]) for s in "LR"}

    rows = []
    sole_co = {s: [] for s in "LR"}
    for f in range(f_start, f_end + 1):
        sc.frame_set(f)
        co = deformed(mesh)
        for s in "LR":
            sole_co[s].append(co[sole[s]])
        pb = arm.pose.bones
        mw = arm.matrix_world

        def bone_pts(name):
            return [mw @ pb[name].head, mw @ pb[name].tail]

        row = {"frame": f - f_start}
        for s in "LR":
            pts = co[sole[s]]
            low = int(pts[:, 2].argmin())
            row[f"sole_{s}"] = float(pts[low, 2])
            row[f"sole_y_{s}"] = float(pts[low, 1])
            row[f"bone_low_{s}"] = float(min(p.z for p in bone_pts(f"Foot.{s}") + bone_pts(f"Toe.{s}")))
            row[f"ankle_y_{s}"] = float((mw @ pb[f"Foot.{s}"].head).y)
            row[f"hand_y_{s}"] = float((mw @ pb[f"Hand.{s}"].head).y)
        hips = mw @ pb["Hips"].head
        row["hips"] = [float(hips.x), float(hips.y), float(hips.z)]
        row["min_z"] = float(co[:, 2].min())
        rows.append(row)
        if f == f_start:
            first_co = co
        last_co = co
    seam = float(np.linalg.norm(first_co - last_co, axis=1).max())

    loop = rows[:-1]
    t = np.arange(len(loop)) / fps
    result = {"frames": len(loop), "duration": duration, "loopSeam_m": round(seam, 5)}
    stance = {}
    for s in "LR":
        z = np.array([r[f"sole_{s}"] for r in loop])
        mask = z <= CONTACT
        phases = runs(mask)
        stance[s] = phases
        result[f"stance_{s}"] = [{"startFrame": a, "frames": b, "start_s": round(a / fps, 4), "duration_s": round(b / fps, 4)}
                                 for a, b in phases]
        result[f"sole_min_{s}"] = round(float(z.min()), 4)
        result[f"sole_max_{s}"] = round(float(z.max()), 4)
        result[f"footBoneLowest_min_{s}"] = round(float(min(r[f"bone_low_{s}"] for r in loop)), 4)
        if len(phases) != 1:
            problems.append(f"{s} foot has {len(phases)} stance phases (want 1 contiguous)")
    if len(stance["L"]) == 1 and len(stance["R"]) == 1:
        lc = (stance["L"][0][0] + stance["L"][0][1] / 2) / len(loop)
        rc = (stance["R"][0][0] + stance["R"][0][1] / 2) / len(loop)
        offset = (rc - lc) % 1.0
        result["stancePhaseOffset"] = round(offset, 3)
        both = np.array([r["sole_L"] <= CONTACT and r["sole_R"] <= CONTACT for r in loop])
        result["doubleSupportFrames"] = int(both.sum())
        if not 0.35 <= offset <= 0.65:
            problems.append(f"stance phases do not alternate (offset {offset:.2f} of the cycle)")

    def corr(a, b):
        return float(np.corrcoef(a, b)[0, 1])

    hy = {s: np.array([r[f"hand_y_{s}"] - r["hips"][1] for r in loop]) for s in "LR"}
    fy = {s: np.array([r[f"ankle_y_{s}"] - r["hips"][1] for r in loop]) for s in "LR"}
    result["corr_handL_footL"] = round(corr(hy["L"], fy["L"]), 3)
    result["corr_handR_footR"] = round(corr(hy["R"], fy["R"]), 3)
    result["corr_handL_footR"] = round(corr(hy["L"], fy["R"]), 3)
    result["corr_handL_handR"] = round(corr(hy["L"], hy["R"]), 3)
    result["handSwing_m"] = {s: round(float(hy[s].max() - hy[s].min()), 3) for s in "LR"}
    if result["corr_handL_footL"] > -0.5 or result["corr_handR_footR"] > -0.5:
        problems.append("arms do not swing opposite to the same-side leg")
    if result["corr_handL_handR"] > -0.5:
        problems.append("arms do not alternate")

    hips = np.array([r["hips"] for r in loop])
    result["hipsForwardRange_m"] = round(float(np.ptp(hips[:, 1])), 4)
    result["hipsBob_m"] = round(float(np.ptp(hips[:, 2])), 4)
    if result["hipsForwardRange_m"] > 0.12:
        problems.append("root forward translation not removed")
    if result["hipsBob_m"] < 0.02:
        problems.append("no vertical bob")
    result["lowestPoint_m"] = round(float(min(r["min_z"] for r in loop)), 4)

    speeds, slides, ankle_speeds = [], [], []
    stride = clip["strideLength"]
    v = stride / duration
    for s in "LR":
        if len(stance[s]) != 1:
            continue
        a, b = stance[s][0]
        idx = [(a + i) % len(loop) for i in range(b)]
        mid = idx[len(idx) // 2]
        vert = int(sole_co[s][mid][:, 2].argmin())
        track = np.array([sole_co[s][i][vert] for i in idx])
        planted = track[:, 2] <= CONTACT
        ts = np.arange(len(idx))[planted] / fps
        ys = track[planted, 1]
        if len(ys) > 2:
            speeds.append(-np.polyfit(ts, ys, 1)[0])
            slides.append(float(np.ptp(ys + v * ts)))
        ay = np.array([loop[i][f"ankle_y_{s}"] for i in idx])
        if len(ay) > 2:
            ankle_speeds.append(-np.polyfit(np.arange(len(ay)) / fps, ay, 1)[0])
    if ankle_speeds:
        result["stanceAnkleSpeed_mps"] = round(float(np.mean(ankle_speeds)), 3)
    if speeds:
        measured = float(np.mean(speeds))
        result["contactPointSpeed_mps"] = round(measured, 3)
        result["manifestGroundSpeed_mps"] = round(v, 3)
        result["measuredStride_m"] = round(measured * duration, 3)
        result["manifestStride_m"] = stride
        result["worldContactSlideDuringStance_m"] = [round(x, 3) for x in slides]
        if abs(measured - v) / v > 0.15:
            problems.append(f"contact point speed {measured:.2f} m/s does not match ground speed {v:.2f} m/s")
    if seam > 0.002:
        problems.append(f"loop seam {seam * 1000:.1f} mm")

    for name, c in anim["clips"].items():
        act = next(actions[n] for n in found if n == name or n.startswith(name + "_"))
        fr = act.frame_range
        d = (fr[1] - fr[0]) / fps
        result[f"{name}_duration"] = round(d, 4)
        if abs(d - c["duration"]) > 1e-3:
            problems.append(f"{name} duration {d:.4f} != manifest {c['duration']}")

    render_strip(cid, arm, mesh, sole, f_start, n, fps, rows)
    result["problems"] = problems
    out = os.path.join(ROOT, "assets", "renders", f"{cid}_run_check.json")
    with open(out, "w") as fh:
        json.dump({"summary": result, "frames": rows}, fh, indent=1)
    log(f"{cid}: {json.dumps(result, indent=1)}")
    log(f"{cid}: {'OK' if not problems else 'FAIL ' + '; '.join(problems)}")
    return not problems


def render_strip(cid, arm, mesh, sole, f_start, n, fps, rows):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 400, 560
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.72, 0.75, 0.82, 1)
    sc.world = world
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new("g")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.47, 0.5, 1)
    ground.data.materials.append(gm)
    for k in range(-6, 7):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0.5, k * 0.25, 0.0005))
        tick = bpy.context.active_object
        tick.scale = (0.9, 0.006, 0.001)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(40), math.radians(10), math.radians(70))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.0
    cam.location = (4.0, 0.0, 0.9)
    cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    sc.collection.objects.link(cam)
    sc.camera = cam
    markers = {}
    for s, color in (("L", (0.1, 0.9, 0.2, 1)), ("R", (0.95, 0.1, 0.1, 1))):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(0, 0, 0))
        m = bpy.context.active_object
        mat = bpy.data.materials.new(f"m{s}")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = 2.0
        m.data.materials.append(mat)
        markers[s] = m
    tiles = []
    for i in range(8):
        f = f_start + round(i * n / 8)
        sc.frame_set(f)
        row = rows[f - f_start]
        for s in "LR":
            m = markers[s]
            contact = row[f"sole_{s}"] <= CONTACT
            m.hide_render = not contact
            m.location = (0.6, row[f"sole_y_{s}"], 0.0)
        path = f"/tmp/{cid}_strip_{i}.png"
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tiles.append(path)
    imgs = []
    for p in tiles:
        im = bpy.data.images.load(p)
        w, h = im.size
        imgs.append(np.array(im.pixels[:]).reshape(h, w, 4))
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    canvas = np.ones((h, w * len(imgs), 4))
    for i, a in enumerate(imgs):
        a = a.copy()
        a[:, -2:, :3] = 0.2
        canvas[:, i * w:(i + 1) * w] = a
    img = bpy.data.images.new("strip", w * len(imgs), h, alpha=True)
    img.pixels = canvas.ravel()
    img.filepath_raw = os.path.join(ROOT, "assets", "renders", f"{cid}_run_strip.png")
    img.file_format = "PNG"
    img.save()
    log(f"{cid}: wrote {img.filepath_raw}")


ok = all([check(cid) for cid in ids])
sys.exit(0 if ok else 1)
