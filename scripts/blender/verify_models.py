"""Independent check of public/models/*.glb against assets/manifest.json and the brief's budgets.

    blender -b --python scripts/blender/verify_models.py

Prints one line per model and exits non-zero on any failure.
"""

import json
import os
import sys

import bmesh
import bpy

BUDGETS = {"runner": 30000, "guard": 30000, "dog": 30000}
PROP_BUDGET = 8000
TOLERANCE = 0.002

with open("assets/manifest.json") as fh:
    manifest = json.load(fh)

failures = []
for aid, entry in manifest.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=entry["file"])
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    coords = [(w.x, w.z, -w.y) for o in meshes for w in (o.matrix_world @ v.co for v in o.data.vertices)]
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    mn = [min(c[i] for c in coords) for i in range(3)]
    mx = [max(c[i] for c in coords) for i in range(3)]
    images = [n.image for o in meshes for m in o.data.materials for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    bm = bmesh.new()
    for o in meshes:
        bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    bm.free()

    problems = []
    if tris != entry["triangles"]:
        problems.append(f"triangles {tris} != manifest {entry['triangles']}")
    if tris > BUDGETS.get(aid, PROP_BUDGET):
        problems.append(f"over budget {tris}")
    if any(abs(a - b) > TOLERANCE for a, b in zip(mn + mx, entry["bounds"]["min"] + entry["bounds"]["max"])):
        problems.append("bounds differ from manifest")
    if abs(mn[1]) > TOLERANCE:
        problems.append(f"min y {mn[1]:.4f} is not on the ground")
    if abs((mn[0] + mx[0]) / 2) > 0.01 or abs((mn[2] + mx[2]) / 2) > 0.01:
        problems.append("origin is not bottom center")
    if not images or not all(img.packed_file or img.filepath == "" for img in images):
        problems.append("base-color texture missing")
    if not os.path.exists(f"assets/renders/{aid}.png"):
        problems.append("render missing")
    size = images[0].size[:] if images else None
    print(f"[verify] {aid}: tris={tris} height={mx[1] - mn[1]:.3f} size=({mx[0]-mn[0]:.2f},{mx[1]-mn[1]:.2f},{mx[2]-mn[2]:.2f}) "
          f"texture={size} open_edges={boundary} parts={[p['name'] for p in entry['parts']]} {'OK' if not problems else problems}")
    if problems:
        failures.append(aid)

print(f"[verify] {len(manifest) - len(failures)}/{len(manifest)} passed")
sys.exit(1 if failures else 0)
