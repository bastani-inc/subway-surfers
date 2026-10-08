"""Clean up raw Hunyuan3D GLBs into game-ready models, preview renders and assets/manifest.json.

Run from the repository root:
    blender -b --python scripts/blender/cleanup_models.py              # every asset
    blender -b --python scripts/blender/cleanup_models.py -- coin dog  # a subset (manifest entries are merged)

Conventions (docs/brief.md): 1 unit = 1 m, glTF Y-up, model front faces -Z (the run direction),
trains run along Z, origin at the bottom center so the model rests on y = 0.
Hunyuan3D outputs face glTF +Z (Blender -Y); every asset is turned to face Blender +Y (glTF -Z).
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.getcwd()
RAW_DIR = os.path.join(ROOT, "assets", "raw")
OUT_DIR = os.path.join(ROOT, "public", "models")
RENDER_DIR = os.path.join(ROOT, "assets", "renders")
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")

CHARACTER_BUDGET = 30000
PROP_BUDGET = 8000

ASSETS = {
    "runner": {"budget": CHARACTER_BUDGET, "fit": {"height": 1.7}, "yaw": 180, "texture": 2048},
    "guard": {"budget": CHARACTER_BUDGET, "fit": {"height": 1.9}, "yaw": 180, "texture": 2048, "ground_slab": True},
    "dog": {"budget": CHARACTER_BUDGET, "fit": {"height": 0.85}, "yaw": 180, "texture": 2048},
    "train": {"budget": PROP_BUDGET, "fit": {"width": 2.0, "length": 12.0, "height": 3.2}, "yaw": 180, "texture": 2048},
    "barrier_low": {"budget": PROP_BUDGET, "fit": {"width": 2.0, "height": 1.0, "depth_scale": 0.6}, "yaw": 180, "texture": 1024, "align_feet": True},
    "barrier_high": {"budget": PROP_BUDGET, "fit": {"width": 2.1}, "yaw": 180, "texture": 1024, "gantry_clearance": 1.2, "align_feet": True},
    "coin": {"budget": PROP_BUDGET, "fit": {"height": 0.6}, "yaw": 180, "texture": 1024, "octagon_clip": True},
    "jetpack": {"budget": PROP_BUDGET, "fit": {"height": 0.9}, "yaw": 180, "texture": 1024},
    "sneakers": {"budget": PROP_BUDGET, "fit": {"height": 0.8}, "yaw": 180, "texture": 1024},
    "magnet": {"budget": PROP_BUDGET, "fit": {"height": 0.7}, "yaw": 180, "texture": 1024},
    "multiplier": {"budget": PROP_BUDGET, "fit": {"height": 0.7}, "yaw": 90, "texture": 1024, "twin_slabs_x": True},
    "building_a": {"budget": PROP_BUDGET, "fit": {"height": 36.0}, "yaw": 180, "texture": 1024},
    "building_b": {"budget": PROP_BUDGET, "fit": {"height": 24.0}, "yaw": 180, "texture": 1024},
}


def log(msg):
    print(f"[cleanup] {msg}", flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def import_single_mesh(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = mesh_objects()
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.data.transform(ob.matrix_world)
    ob.parent = None
    ob.matrix_world = Matrix.Identity(4)
    for o in list(bpy.context.scene.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    return ob


def islands(bm):
    bm.verts.ensure_lookup_table()
    seen = set()
    groups = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        seen.add(v.index)
        members = []
        while stack:
            x = stack.pop()
            members.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
        groups.append(members)
    return groups


def remove_loose_fragments(bm, keep_fraction=0.01):
    groups = sorted(islands(bm), key=len, reverse=True)
    largest = len(groups[0])
    doomed = [v for g in groups if len(g) < keep_fraction * largest for v in g]
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    loose_edges = [e for e in bm.edges if not e.link_faces]
    if loose_edges:
        bmesh.ops.delete(bm, geom=loose_edges, context="EDGES")
    loose_verts = [v for v in bm.verts if not v.link_faces]
    if loose_verts:
        bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")
    return len(groups) - 1 - sum(1 for g in groups[1:] if len(g) >= keep_fraction * largest)


def remove_twin_slabs_x(bm, band=0.015):
    """Multiplier: Hunyuan wrapped the token between two square background plates at the X extremes."""
    xs = [v.co.x for v in bm.verts]
    lo, hi = min(xs), max(xs)
    doomed = [f for f in bm.faces if all(v.co.x < lo + band or v.co.x > hi - band for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    return len(doomed)


def remove_ground_slab(bm):
    """Guard: Hunyuan fused a thin ground plate around the boots. The plate's top is the height with
    the largest upward-facing area near the bottom. Cut everything below it (plate plus the sliver of
    sole poking through) and cap the open boot bottoms flat at the plate top."""
    zs = [v.co.z for v in bm.verts]
    lo, hi = min(zs), max(zs)
    step = 0.0025 * (hi - lo)
    area = {}
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.z > 0.8 and c.z < lo + 0.15 * (hi - lo):
            key = int((c.z - lo) / step)
            area[key] = area.get(key, 0.0) + f.calc_area()
    peak = max(area, key=area.get)
    cut = lo + (peak + 1) * step + 0.002 * (hi - lo)
    doomed = [f for f in bm.faces if any(v.co.z < cut for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    groups = sorted(islands(bm), key=len, reverse=True)
    for g in groups[1:]:
        if len(g) < 0.01 * len(groups[0]):
            bmesh.ops.delete(bm, geom=g, context="VERTS")
    return f"{len(doomed)} faces below {cut - lo:.3f} raw units"


def sample_base_color(ob):
    image = base_color_image(ob.data.materials[0])
    w, h = image.size
    pixels = image.pixels[:]
    channels = image.channels

    def lookup(uv):
        px = min(w - 1, max(0, int((uv.x % 1.0) * w)))
        py = min(h - 1, max(0, int((uv.y % 1.0) * h)))
        i = (py * w + px) * channels
        return pixels[i], pixels[i + 1], pixels[i + 2]

    return lookup


def clip_coin_to_octagon(ob, bm):
    """Coin: the hex-edged coin was fused onto a square backing plate. Find its cyan rim in the
    texture, fit the tightest octagon around it, and bisect the plate away along those eight planes."""
    lookup = sample_base_color(ob)
    uv_layer = bm.loops.layers.uv.active
    xs = [v.co.x for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    half = min(max(xs) - min(xs), max(zs) - min(zs)) / 2
    rim = []
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            if max(abs(co.x - cx), abs(co.z - cz)) > 0.94 * half:
                continue
            r, g, b = lookup(loop[uv_layer].uv)
            if b > 0.35 and g > 0.3 and b > r * 1.6:
                rim.append(co.copy())
    center = Vector((cx, 0.0, cz))
    best = None
    for step in range(45):
        theta0 = math.radians(step)
        normals = [Vector((math.cos(theta0 + k * math.pi / 4), 0.0, math.sin(theta0 + k * math.pi / 4))) for k in range(8)]
        offsets = [max(n.dot(p - center) for p in rim) for n in normals]
        score = sum(offsets)
        if best is None or score < best[0]:
            best = (score, normals, offsets)
    _, normals, offsets = best
    for n, d in zip(normals, offsets):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=center + n * (d + 0.004), plane_no=n, clear_outer=True)
    rim_edges = [e for e in bm.edges if e.is_boundary]
    if rim_edges:
        bridged = bmesh.ops.bridge_loops(bm, edges=rim_edges)["faces"]
        bridged_set = set(bridged)
        for f in bridged:
            for loop in f.loops:
                donor = next((l for l in loop.vert.link_loops if l.face not in bridged_set), None)
                if donor is not None:
                    loop[uv_layer].uv = donor[uv_layer].uv
    return len(rim)


def base_color_image(mat):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            link = node.inputs["Base Color"].links
            if link and link[0].from_node.type == "TEX_IMAGE":
                return link[0].from_node.image
    return next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")


def simplify_material(ob, texture_size):
    """Keep only the base-color texture (resized, packed) on a plain Principled BSDF."""
    mat = ob.data.materials[0]
    image = base_color_image(mat)
    if max(image.size) > texture_size:
        image.scale(texture_size, texture_size)
    image.pack()
    tree = mat.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.6
    tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for slot_mat in list(bpy.data.images):
        if slot_mat is not image and slot_mat.users == 0:
            bpy.data.images.remove(slot_mat)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    mat.name = f"{ob.name}_mat"
    image.name = f"{ob.name}_basecolor"


def bounds_of(coords):
    mn = Vector((min(c.x for c in coords), min(c.y for c in coords), min(c.z for c in coords)))
    mx = Vector((max(c.x for c in coords), max(c.y for c in coords), max(c.z for c in coords)))
    return mn, mx


def fit_scale(ob, fit):
    """Blender axes: X width, Y length (forward), Z height."""
    mn, mx = bounds_of([v.co for v in ob.data.vertices])
    size = mx - mn
    if "width" in fit and "length" in fit and "height" in fit:
        s = Vector((fit["width"] / size.x, fit["length"] / size.y, fit["height"] / size.z))
    elif "width" in fit and "height" in fit:
        sx = fit["width"] / size.x
        s = Vector((sx, sx * fit.get("depth_scale", 1.0), fit["height"] / size.z))
    elif "width" in fit:
        u = fit["width"] / size.x
        s = Vector((u, u, u))
    else:
        u = fit["height"] / size.z
        s = Vector((u, u, u))
    ob.data.transform(Matrix.Diagonal(s.to_4d()))
    return s


def squash_gantry_posts(ob, clearance):
    """Barrier_high: the generated gantry's beam sits too high to force a roll. Find the beam's
    underside above the empty center gap and compress the posts so the beam bottom lands at
    `clearance` metres; everything above the gap shifts down rigidly."""
    verts = ob.data.vertices
    mn, mx = bounds_of([v.co for v in verts])
    half = (mx.x - mn.x) / 2
    center = (mx.x + mn.x) / 2
    beam_bottom = min(v.co.z for v in verts if abs(v.co.x - center) < 0.3 * half)
    floor = mn.z
    feet_top = floor + 0.25 * (beam_bottom - floor)
    target_bottom = floor + clearance
    shift = beam_bottom - target_bottom
    for v in verts:
        z = v.co.z
        if z >= beam_bottom:
            v.co.z = z - shift
        elif z > feet_top:
            t = (z - feet_top) / (beam_bottom - feet_top)
            v.co.z = feet_top + t * (target_bottom - feet_top)
    return beam_bottom - floor, shift


def align_feet_to_x(ob):
    """Barriers: Hunyuan left the two feet skewed in plan. Rotate about Z so the line through the
    left and right foot centroids runs along X, keeping the barrier square to the lane."""
    verts = [v.co for v in ob.data.vertices]
    mn, mx = bounds_of(verts)
    center_x = (mn.x + mx.x) / 2
    feet = [c for c in verts if c.z < mn.z + 0.15 * (mx.z - mn.z)]
    left = [c for c in feet if c.x < center_x]
    right = [c for c in feet if c.x >= center_x]
    lc = sum(left, Vector()) / len(left)
    rc = sum(right, Vector()) / len(right)
    angle = math.atan2(rc.y - lc.y, rc.x - lc.x)
    ob.data.transform(Matrix.Rotation(-angle, 4, "Z"))
    return math.degrees(angle)


def fill_open_holes(ob):
    """Cap holes left by slab removal or present in the raw scan (boot bottoms, token back).
    Cap faces borrow the UVs of their rim vertices so they take the neighbouring texture colour."""
    me = ob.data
    marker = me.attributes.new("original_face", "INT", "FACE")
    marker.data.foreach_set("value", [1] * len(me.polygons))
    bm = bmesh.new()
    bm.from_mesh(me)
    open_edges = sum(1 for e in bm.edges if e.is_boundary)
    bm.free()
    if open_edges:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.fill_holes(sides=0)
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.mesh.select_mode(type="EDGE")
        bpy.ops.mesh.select_non_manifold(extend=False, use_wire=False, use_boundary=True,
                                         use_multi_face=False, use_non_contiguous=False, use_verts=False)
        if any(e.select for e in bmesh.from_edit_mesh(me).edges):
            bpy.ops.mesh.fill(use_beauty=True)
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.quads_convert_to_tris()
        bpy.ops.object.mode_set(mode="OBJECT")
        bm = bmesh.new()
        bm.from_mesh(me)
        layer = bm.faces.layers.int["original_face"]
        uv_layer = bm.loops.layers.uv.active
        for f in bm.faces:
            if f[layer]:
                continue
            for loop in f.loops:
                donor = next((l for l in loop.vert.link_loops if l.face[layer]), None)
                if donor is not None:
                    loop[uv_layer].uv = donor[uv_layer].uv
        bm.to_mesh(me)
        bm.free()
    me.attributes.remove(me.attributes["original_face"])
    return open_edges


def triangle_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def decimate(ob, budget):
    for _ in range(4):
        tris = triangle_count(ob.data)
        if tris <= budget:
            return tris
        mod = ob.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = (budget * 0.97) / tris
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return triangle_count(ob.data)


def place_origin_bottom_center(ob):
    mn, mx = bounds_of([v.co for v in ob.data.vertices])
    offset = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    ob.data.transform(Matrix.Translation(-offset))


def triangulate(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()


def clean_asset(aid, cfg):
    reset_scene()
    raw = os.path.join(RAW_DIR, f"{aid}.glb")
    if not os.path.exists(raw):
        raise FileNotFoundError(f"{raw} is missing; a stand-in must be modelled for {aid}")
    ob = import_single_mesh(raw)
    ob.name = aid
    ob.data.name = aid
    raw_tris = triangle_count(ob.data)

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    notes = []
    if cfg.get("twin_slabs_x"):
        notes.append(f"removed {remove_twin_slabs_x(bm)} background-plate faces")
    if cfg.get("ground_slab"):
        notes.append(f"ground slab: {remove_ground_slab(bm)}")
    if cfg.get("octagon_clip"):
        notes.append(f"clipped backing plate to octagon fitted on {clip_coin_to_octagon(ob, bm)} rim samples")
    dropped = remove_loose_fragments(bm)
    notes.append(f"dropped {dropped} loose fragments")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    notes.append(f"filled {fill_open_holes(ob)} open boundary edges")

    decimate(ob, cfg["budget"])
    triangulate(ob)
    if cfg.get("align_feet"):
        notes.append(f"straightened feet skew of {align_feet_to_x(ob):.1f} deg")
    ob.data.transform(Matrix.Rotation(math.radians(cfg["yaw"]), 4, "Z"))
    scale = fit_scale(ob, cfg["fit"])
    if "gantry_clearance" in cfg:
        old, shift = squash_gantry_posts(ob, cfg["gantry_clearance"])
        notes.append(f"beam underside {old:.2f} m -> {cfg['gantry_clearance']:.2f} m")

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    place_origin_bottom_center(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    simplify_material(ob, cfg["texture"])

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{aid}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_selection=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=90,
        export_normals=True,
        export_texcoords=True,
    )
    log(f"{aid}: raw {raw_tris} tris, scale {tuple(round(c, 3) for c in scale)}, {'; '.join(notes)} -> {out}")
    return out


def gltf_coords(ob):
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    mw = ob.matrix_world
    out = []
    for v in ob.data.vertices:
        w = mw @ v.co
        out.append(Vector((w.x, w.z, -w.y)))
    return out


def r3(vec):
    return [round(c, 4) for c in vec]


def part(name, coords):
    mn, mx = bounds_of(coords)
    return {"name": name, "min": r3(mn), "max": r3(mx)}


def measure_parts(aid, coords):
    if aid == "barrier_high":
        mn, mx = bounds_of(coords)
        center = (mn.x + mx.x) / 2
        half = (mx.x - mn.x) / 2
        beam_bottom = min(c.y for c in coords if abs(c.x - center) < 0.3 * half)
        below = [c for c in coords if c.y < beam_bottom - 0.02]
        left_inner = max(c.x for c in below if c.x < center)
        right_inner = min(c.x for c in below if c.x > center)
        beam = [c for c in coords if left_inner < c.x < right_inner]
        beam_part = part("beam", beam)
        beam_part["min"][0] = round(left_inner, 4)
        beam_part["max"][0] = round(right_inner, 4)
        return [
            beam_part,
            part("postLeft", [c for c in coords if c.x <= left_inner]),
            part("postRight", [c for c in coords if c.x >= right_inner]),
        ]
    if aid == "train":
        mn, mx = bounds_of(coords)
        roof_cut = mx.y - 0.25
        return [
            part("body", [c for c in coords if c.y < roof_cut]),
            part("roof", [c for c in coords if c.y >= roof_cut]),
        ]
    return [part("body", coords)]


def measure_export(aid, path):
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = mesh_objects()
    coords = [c for o in meshes for c in gltf_coords(o)]
    tris = sum(triangle_count(o.data) for o in meshes)
    mn, mx = bounds_of(coords)
    textured = any(
        n.type == "TEX_IMAGE" and n.image is not None
        for o in meshes for m in o.data.materials if m and m.use_nodes for n in m.node_tree.nodes
    )
    return {
        "file": f"public/models/{aid}.glb",
        "triangles": tris,
        "bounds": {"min": r3(mn), "max": r3(mx)},
        "parts": measure_parts(aid, coords),
        "standIn": False,
    }, textured


def render_preview(aid, entry):
    """Scene already holds the re-imported export. Eevee, three-quarter front view, shadowed ground."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1024
    sc.render.resolution_y = 1024
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.62, 0.66, 0.74, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = world

    mn = Vector(entry["bounds"]["min"])
    mx = Vector(entry["bounds"]["max"])
    size = mx - mn
    radius = 0.5 * size.length
    center_b = Vector(((mn.x + mx.x) / 2, -(mn.z + mx.z) / 2, (mn.y + mx.y) / 2))

    bpy.ops.mesh.primitive_plane_add(size=max(size.x, size.y, size.z) * 8, location=(center_b.x, center_b.y, 0))
    ground = bpy.context.active_object
    gmat = bpy.data.materials.new("ground")
    gmat.use_nodes = True
    gb = gmat.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (0.55, 0.56, 0.6, 1.0)
    gb.inputs["Roughness"].default_value = 0.9
    ground.data.materials.append(gmat)

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(6)
    sun.data.use_shadow = True
    sun.rotation_euler = (-Vector((-0.2, 0.8, 1.1))).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(sun)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam
    direction = Vector((0.75, 1.0, 0.55)).normalized()
    fov = 2 * math.atan(cam.data.sensor_width / (2 * cam.data.lens))
    distance = radius / math.sin(fov / 2) * 1.05
    cam.location = center_b + direction * distance
    cam.rotation_euler = (center_b - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = distance * 10
    cam.data.clip_start = distance / 1000

    os.makedirs(RENDER_DIR, exist_ok=True)
    sc.render.filepath = os.path.join(RENDER_DIR, f"{aid}.png")
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ids = argv or list(ASSETS)
    manifest = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as fh:
            manifest = json.load(fh)
    for aid in ids:
        path = clean_asset(aid, ASSETS[aid])
        entry, textured = measure_export(aid, path)
        if not textured:
            raise RuntimeError(f"{aid}: exported GLB lost its base-color texture")
        render_preview(aid, entry)
        manifest[aid] = entry
        h = entry["bounds"]["max"][1] - entry["bounds"]["min"][1]
        log(f"{aid}: {entry['triangles']} tris, height {h:.3f} m, bounds {entry['bounds']}")
    ordered = {k: manifest[k] for k in sorted(manifest)}
    with open(MANIFEST, "w") as fh:
        json.dump(ordered, fh, indent=2)
        fh.write("\n")
    log(f"wrote {MANIFEST} ({len(ordered)} entries)")


main()
