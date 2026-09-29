extends Node3D

var character_root: Node3D
var character_instance: Node3D
var skeleton: Skeleton3D
var camera: Camera3D

var yaw := 0.0
var zoom := 4.0
var touches := {}
var last_pinch_distance := 0.0
var idle_t := 0.0

var spine_idx := -1
var head_idx := -1
var arm_l_idx := -1
var arm_r_idx := -1
var spine_base := Quaternion.IDENTITY
var head_base := Quaternion.IDENTITY
var arm_l_base := Quaternion.IDENTITY
var arm_r_base := Quaternion.IDENTITY

func _ready():
    _build_stage()
    _load_character()
    _build_ui()

func _build_stage():
    var env_node := WorldEnvironment.new()
    var env := Environment.new()
    env.background_mode = Environment.BG_COLOR
    env.background_color = Color(0.012, 0.015, 0.024)
    env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    env.ambient_light_color = Color(0.22, 0.25, 0.34)
    env.ambient_light_energy = 1.2
    env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
    env_node.environment = env
    add_child(env_node)

    var key := DirectionalLight3D.new()
    key.rotation_degrees = Vector3(-36, -28, 0)
    key.light_energy = 2.6
    key.light_color = Color(1.0, 0.82, 0.72)
    key.shadow_enabled = true
    add_child(key)

    var fill := OmniLight3D.new()
    fill.position = Vector3(-2.4, 2.0, 2.5)
    fill.light_color = Color(0.22, 0.35, 0.9)
    fill.light_energy = 3.6
    fill.omni_range = 8.0
    add_child(fill)

    var rim := OmniLight3D.new()
    rim.position = Vector3(2.3, 2.2, -2.0)
    rim.light_color = Color(0.8, 0.08, 0.08)
    rim.light_energy = 2.8
    rim.omni_range = 7.0
    add_child(rim)

    var floor := MeshInstance3D.new()
    var plane := PlaneMesh.new()
    plane.size = Vector2(10, 10)
    floor.mesh = plane
    var fm := StandardMaterial3D.new()
    fm.albedo_color = Color(0.028, 0.032, 0.045)
    fm.metallic = 0.35
    fm.roughness = 0.35
    floor.material_override = fm
    add_child(floor)

    var podium := MeshInstance3D.new()
    var cyl := CylinderMesh.new()
    cyl.top_radius = 1.25
    cyl.bottom_radius = 1.45
    cyl.height = 0.20
    cyl.radial_segments = 64
    podium.mesh = cyl
    podium.position.y = 0.10
    var pm := StandardMaterial3D.new()
    pm.albedo_color = Color(0.12, 0.13, 0.16)
    pm.metallic = 0.85
    pm.roughness = 0.18
    podium.material_override = pm
    add_child(podium)

    character_root = Node3D.new()
    character_root.position.y = 0.20
    add_child(character_root)

    camera = Camera3D.new()
    camera.fov = 42.0
    camera.position = Vector3(0, 1.25, zoom)
    add_child(camera)
    camera.look_at(Vector3(0, 1.0, 0), Vector3.UP)

func _load_character():
    var scene: PackedScene = load("res://assets/characters/Superhero_Male_FullBody.gltf")
    if scene == null:
        push_error("Male 3D model could not be loaded")
        return

    character_instance = scene.instantiate()
    character_root.add_child(character_instance)
    character_instance.position = Vector3.ZERO
    character_instance.rotation_degrees.y = 180.0
    character_instance.scale = Vector3.ONE

    skeleton = _find_skeleton(character_instance)
    if skeleton != null:
        _cache_bones()

func _find_skeleton(n: Node) -> Skeleton3D:
    if n is Skeleton3D:
        return n as Skeleton3D
    for child in n.get_children():
        var found := _find_skeleton(child)
        if found != null:
            return found
    return null

func _cache_bones():
    var spine_names = ["spine_02", "spine_03", "spine_01"]
    for name in spine_names:
        spine_idx = skeleton.find_bone(name)
        if spine_idx >= 0:
            break

    head_idx = skeleton.find_bone("Head")
    if head_idx < 0:
        head_idx = skeleton.find_bone("head")

    arm_l_idx = skeleton.find_bone("upperarm_l")
    arm_r_idx = skeleton.find_bone("upperarm_r")

    if spine_idx >= 0:
        spine_base = skeleton.get_bone_pose_rotation(spine_idx)
    if head_idx >= 0:
        head_base = skeleton.get_bone_pose_rotation(head_idx)
    if arm_l_idx >= 0:
        arm_l_base = skeleton.get_bone_pose_rotation(arm_l_idx)
    if arm_r_idx >= 0:
        arm_r_base = skeleton.get_bone_pose_rotation(arm_r_idx)

func _process(delta):
    idle_t += delta

    character_root.rotation_degrees.y = yaw
    character_root.position.y = 0.20 + sin(idle_t * 1.7) * 0.008

    if skeleton != null:
        var breath := sin(idle_t * 1.7)
        if spine_idx >= 0:
            skeleton.set_bone_pose_rotation(
                spine_idx,
                spine_base * Quaternion(Vector3.RIGHT, deg_to_rad(1.4 * breath))
            )
        if head_idx >= 0:
            skeleton.set_bone_pose_rotation(
                head_idx,
                head_base * Quaternion(Vector3.UP, deg_to_rad(1.0 * sin(idle_t * 0.8)))
            )
        if arm_l_idx >= 0:
            skeleton.set_bone_pose_rotation(
                arm_l_idx,
                arm_l_base * Quaternion(Vector3.FORWARD, deg_to_rad(0.8 * breath))
            )
        if arm_r_idx >= 0:
            skeleton.set_bone_pose_rotation(
                arm_r_idx,
                arm_r_base * Quaternion(Vector3.FORWARD, deg_to_rad(-0.8 * breath))
            )

    camera.position = Vector3(0, 1.30, zoom)
    camera.look_at(Vector3(0, 1.05, 0), Vector3.UP)

func _build_ui():
    var layer := CanvasLayer.new()
    add_child(layer)

    var root := Control.new()
    root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    root.mouse_filter = Control.MOUSE_FILTER_IGNORE
    layer.add_child(root)

    var title := Label.new()
    title.text = "ŞAOMİ 3D ERKEK KARAKTER"
    title.position = Vector2(36, 28)
    title.add_theme_font_size_override("font_size", 34)
    root.add_child(title)

    var hint := Label.new()
    hint.text = "Parmağınla sağa-sola sürükle: 360° döndür   •   İki parmak: yakınlaştır / uzaklaştır"
    hint.position = Vector2(36, 82)
    hint.add_theme_font_size_override("font_size", 18)
    hint.modulate = Color(0.82, 0.84, 0.9)
    root.add_child(hint)

    var idle := Label.new()
    idle.text = "IDLE ANİMASYON AKTİF"
    idle.position = Vector2(36, 1020)
    idle.add_theme_font_size_override("font_size", 16)
    idle.modulate = Color(0.92, 0.70, 0.34)
    root.add_child(idle)

func _input(event):
    if event is InputEventScreenTouch:
        if event.pressed:
            touches[event.index] = event.position
        else:
            touches.erase(event.index)
            last_pinch_distance = 0.0

    elif event is InputEventScreenDrag:
        touches[event.index] = event.position

        if touches.size() == 1:
            yaw += event.relative.x * 0.30

        elif touches.size() >= 2:
            var pts := touches.values()
            var dist: float = pts[0].distance_to(pts[1])
            if last_pinch_distance > 0.0:
                zoom = clamp(zoom - (dist - last_pinch_distance) * 0.006, 2.6, 5.4)
            last_pinch_distance = dist

    elif event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
        yaw += event.relative.x * 0.25
