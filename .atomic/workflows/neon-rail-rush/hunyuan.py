import os
import shutil
import sys

from gradio_client import Client, handle_file

image_path, output_path = sys.argv[1], sys.argv[2]
client = Client("tencent/Hunyuan3D-2.1", token=os.environ["HF_TOKEN"], verbose=False)
result = client.predict(
    image=handle_file(image_path),
    mv_image_front=None,
    mv_image_back=None,
    mv_image_left=None,
    mv_image_right=None,
    steps=30,
    guidance_scale=5.0,
    seed=1234,
    octree_resolution=256,
    check_box_rembg=True,
    num_chunks=8000,
    randomize_seed=False,
    api_name="/generation_all",
)


def file_path(item):
    if isinstance(item, dict):
        return item.get("value") or item.get("path") or item.get("name")
    return item


shape_file, textured_file = file_path(result[0]), file_path(result[1])
chosen = textured_file if textured_file and os.path.exists(textured_file) else shape_file
if not chosen or not os.path.exists(chosen):
    sys.exit(f"Hunyuan3D returned no mesh file: {result!r}"[:2000])
os.makedirs(os.path.dirname(output_path), exist_ok=True)
shutil.copyfile(chosen, output_path)
print(f"textured={chosen == textured_file} source_ext={os.path.splitext(chosen)[1]}")
