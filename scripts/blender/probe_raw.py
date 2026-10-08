"""Diagnostics for raw Hunyuan3D GLBs: island stats after welding and four-side workbench views.
Usage: blender -b --python scripts/blender/probe_raw.py -- <id> [<id> ...]"""
import bpy, bmesh, sys, os, math
from mathutils import Vector

ids = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
os.makedirs("/tmp/probe", exist_ok=True)

def islands(bm):
    bm.verts.ensure_lookup_table()
    seen = set(); out = []
    for v in bm.verts:
        if v.index in seen: continue
        stack = [v]; seen.add(v.index); members = []
        while stack:
            x = stack.pop(); members.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen: seen.add(y.index); stack.append(y)
        out.append(members)
    return out

for aid in ids:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f"assets/raw/{aid}.glb")
    ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    isl = islands(bm)
    isl.sort(key=len, reverse=True)
    print(f"PROBE {aid} verts={len(bm.verts)} islands={len(isl)}")
    for m in isl[:8]:
        co = [ob.matrix_world @ v.co for v in m]
        mn = Vector(map(min, *co)); mx = Vector(map(max, *co))
        d = mx - mn
        print(f"PROBE   n={len(m)} dims=({d.x:.3f},{d.y:.3f},{d.z:.3f}) min=({mn.x:.2f},{mn.y:.2f},{mn.z:.2f})")
    small = sum(1 for m in isl if len(m) < 0.01 * len(isl[0]))
    print(f"PROBE   tiny(<1% of largest)={small}")
    bm.free()
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.light = 'STUDIO'
    sc.render.resolution_x = sc.render.resolution_y = 400
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.4
    for name, pos in {"py": (0, 5, 0), "ny": (0, -5, 0), "px": (5, 0, 0), "nx": (-5, 0, 0)}.items():
        cam.location = pos
        cam.rotation_euler = (Vector((0, 0, 0)) - Vector(pos)).to_track_quat('-Z', 'Z').to_euler()
        sc.render.filepath = f"/tmp/probe/{aid}_{name}.png"
        bpy.ops.render.render(write_still=True)
