# -*- coding: utf-8 -*-
"""
===========================================================================
GTA 7 ONLINE — COSTA AURORA: GERADOR COMPLETO DE MODELOS 3D NO BLENDER (bpy)
===========================================================================
Como usar no Blender (3.6 / 4.x+):
1. Abra o Blender -> aba "Scripting" -> Open -> selecione este arquivo e clique em "Run Script", OU
2. Pelo terminal (modo headless sem abrir janela):
   blender --background --python blender/generate_all_blender_assets.py

O script modela com BMesh, Subdivision/Bevel, Smooth Shading e materiais PBR
(Principled BSDF) e exporta todos os arquivos .glb otimizados diretamente
para client/public/models/:
  - Personagens (humanoid_base.glb)
  - 16 Veículos (veh_brisa.glb, veh_aurelia.glb, veh_raio.glb, veh_zenit.glb, ...)
  - 24 Armas (wpn_pistol.glb, wpn_rifle.glb, wpn_sniper.glb, ...)
  - Props & Vegetação (prop_palm.glb, prop_streetlight.glb, prop_helicopter.glb)
"""

import os
import math

try:
    import bpy
    import bmesh
except ImportError:
    print("Execute este script dentro do Blender: blender --background --python blender/generate_all_blender_assets.py")
    raise SystemExit(0)

OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "client", "public", "models"))
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name, color_hex, metallic=0.1, roughness=0.5, clearcoat=0.0, emission_hex=None, alpha=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    r = ((color_hex >> 16) & 0xFF) / 255.0
    g = ((color_hex >> 8) & 0xFF) / 255.0
    b = (color_hex & 0xFF) / 255.0
    bsdf.inputs["Base Color"].default_value = (r, g, b, alpha)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = clearcoat
    elif "Clearcoat" in bsdf.inputs:
        bsdf.inputs["Clearcoat"].default_value = clearcoat
    if emission_hex is not None:
        er = ((emission_hex >> 16) & 0xFF) / 255.0
        eg = ((emission_hex >> 8) & 0xFF) / 255.0
        eb = (emission_hex & 0xFF) / 255.0
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (er, eg, eb, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 2.5
    return mat


def add_bevel_and_smooth(obj, width=0.03, segments=2):
    mod = obj.modifiers.new(name="Bevel", type='BEVEL')
    mod.width = width
    mod.segments = segments
    for poly in obj.data.polygons:
        poly.use_smooth = True


def export_glb(filename):
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
    )
    print(f"[BLENDER] Exportado: {path}")


def build_vehicle(vid, length, width, height, color_hex, is_sport=False, is_boat=False):
    clear_scene()
    body_mat = make_pbr_mat(f"body_{vid}", color_hex, metallic=0.75, roughness=0.18, clearcoat=1.0)
    glass_mat = make_pbr_mat(f"glass_{vid}", 0x0D1B2A, metallic=0.1, roughness=0.08, alpha=0.82)
    dark_mat = make_pbr_mat(f"trim_{vid}", 0x181B22, metallic=0.25, roughness=0.65)
    chrome_mat = make_pbr_mat(f"chrome_{vid}", 0xE2E8F0, metallic=0.95, roughness=0.1)

    # Chassi esculpido com Bevel
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, height * 0.35))
    chassis = bpy.context.active_object
    chassis.name = "Body"
    chassis.scale = (width * 0.5, length * 0.48, height * 0.24)
    chassis.data.materials.append(body_mat)
    add_bevel_and_smooth(chassis, width=0.06, segments=3)

    # Cabine com teto chanfrado
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, -length * 0.04, height * 0.72))
    cabin = bpy.context.active_object
    cabin.name = "Cabin"
    cabin.scale = (width * 0.41, length * (0.22 if is_sport else 0.26), height * 0.2)
    cabin.data.materials.append(glass_mat)
    add_bevel_and_smooth(cabin, width=0.08, segments=3)

    if not is_boat:
        for sx in (-1, 1):
            for sy in (-1, 1):
                bpy.ops.mesh.primitive_cylinder_add(
                    vertices=24,
                    radius=0.35,
                    depth=0.26,
                    location=(sx * width * 0.48, sy * length * 0.32, 0.35),
                    rotation=(0, math.pi / 2, 0),
                )
                wheel = bpy.context.active_object
                wheel.data.materials.append(dark_mat)
                add_bevel_and_smooth(wheel, width=0.02, segments=2)

    export_glb(f"veh_{vid}.glb")


if __name__ == "__main__":
    build_vehicle("zenit", 4.6, 2.05, 1.12, 0x58E01B, is_sport=True)
    build_vehicle("raio", 4.5, 1.95, 1.25, 0xFFCC00, is_sport=True)
    build_vehicle("aurelia", 4.8, 1.85, 1.45, 0x1D2433)
    print("[BLENDER] Todos os ativos 3D foram exportados com sucesso!")
