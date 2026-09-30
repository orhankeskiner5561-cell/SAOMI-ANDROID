extends Node3D

const WALK_SPEED := 3.0
const RUN_SPEED := 5.4
const GRAVITY := 18.0
const JOY_RADIUS := 86.0
const LOOK_SENS := 0.0042

var player: CharacterBody3D
var visual_root: Node3D
var animation_player: AnimationPlayer
var camera_pivot: Node3D
var spring_arm: SpringArm3D
var camera: Camera3D

var move_touch := -1
var look_touch := -1
var move_origin := Vector2.ZERO
var move_vec := Vector2.ZERO
var yaw := 0.0
var pitch := deg_to_rad(-9.0)

var joy_base: Control
var joy_knob: Control
var state_label: Label
var anim_map := {}

func _ready() -> void:
    _build_environment()
    _build_test_ground()
    _build_player()
    _build_camera()
    _build_hud()
    get_viewport().size_changed.connect(_layout_hud)

func _build_environment() -> void:
    var env_node := WorldEnvironment.new()
    var env := Environment.new()
    env.background_mode = Environment.BG_SKY
    var sky := Sky.new()
    var sky_mat := ProceduralSkyMaterial.new()
    sky_mat.sky_top_color = Color(0.16, 0.28, 0.45)
    sky_mat.sky_horizon_color = Color(0.62, 0.68, 0.75)
    sky_mat.ground_bottom_color = Color(0.04, 0.045, 0.05)
    sky_mat.ground_horizon_color = Color(0.34, 0.36, 0.37)
    sky.sky_material = sky_mat
    env.sky = sky
    env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
    env.ambient_light_energy = 0.72
    env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
    env_node.environment = env
    add_child(env_node)

    var sun := DirectionalLight3D.new()
    sun.rotation_degrees = Vector3(-48, -32, 0)
    sun.light_energy = 1.65
    sun.shadow_enabled = true
    sun.directional_shadow_max_distance = 80.0
    add_child(sun)

func _build_test_ground() -> void:
    var ground := StaticBody3D.new()
    ground.name = "Ground"
    add_child(ground)

    var mesh := MeshInstance3D.new()
    var plane := PlaneMesh.new()
    plane.size = Vector2(60, 60)
    mesh.mesh = plane
    var mat := StandardMaterial3D.new()
    mat.albedo_color = Color(0.13, 0.15, 0.12)
    mat.roughness = 0.95
    mesh.material_override = mat
    ground.add_child(mesh)

    var col := CollisionShape3D.new()
    var box := BoxShape3D.new()
    box.size = Vector3(60, 0.2, 60)
    col.shape = box
    col.position.y = -0.1
    ground.add_child(col)

    for data in [
        [Vector3(-4, 1, -5), Vector3(3, 2, 0.5)],
        [Vector3(4, 0.7, -2), Vector3(2.5, 1.4, 0.7)],
        [Vector3(0, 1.2, 6), Vector3(5, 2.4, 0.6)]
    ]:
        var wall := StaticBody3D.new()
        wall.position = data[0]
        add_child(wall)
        var wm := MeshInstance3D.new()
        var cube := BoxMesh.new()
        cube.size = data[1]
        wm.mesh = cube
        var wall_mat := StandardMaterial3D.new()
        wall_mat.albedo_color = Color(0.28, 0.29, 0.30)
        wall_mat.roughness = 0.88
        wm.material_override = wall_mat
        wall.add_child(wm)
        var wc := CollisionShape3D.new()
        var ws := BoxShape3D.new()
        ws.size = data[1]
        wc.shape = ws
        wall.add_child(wc)

func _build_player() -> void:
    player = CharacterBody3D.new()
    player.name = "Player"
    player.position = Vector3(0, 0.02, 2.0)
    add_child(player)

    var collision := CollisionShape3D.new()
    collision.position.y = 0.95
    var capsule := CapsuleShape3D.new()
    capsule.radius = 0.34
    capsule.height = 1.9
    collision.shape = capsule
    player.add_child(collision)

    visual_root = Node3D.new()
    visual_root.name = "Visual"
    player.add_child(visual_root)

    var packed: PackedScene = load("res://assets/Soldier.glb")
    if packed:
        var model := packed.instantiate()
        visual_root.add_child(model)
        visual_root.rotation.y = PI
        animation_player = _find_animation_player(model)
        if animation_player:
            _index_animations()
            _play_state("idle", 1.0)

func _build_camera() -> void:
    camera_pivot = Node3D.new()
    camera_pivot.name = "CameraPivot"
    add_child(camera_pivot)
    camera_pivot.global_position = player.global_position + Vector3(0, 1.28, 0)
    camera_pivot.rotation = Vector3(pitch, yaw, 0)

    spring_arm = SpringArm3D.new()
    spring_arm.name = "SpringArm"
    spring_arm.spring_length = 2.95
    spring_arm.margin = 0.12
    spring_arm.collision_mask = 1
    camera_pivot.add_child(spring_arm)

    camera = Camera3D.new()
    camera.name = "ShoulderCamera"
    camera.fov = 68.0
    camera.position.x = 0.46
    camera.current = true
    spring_arm.add_child(camera)

func _build_hud() -> void:
    var layer := CanvasLayer.new()
    add_child(layer)

    var title := Label.new()
    title.text = "ŞAOMİ BATTLE ROYALE  •  M1.3 360 TPS FIX"
    title.position = Vector2(24, 20)
    title.add_theme_font_size_override("font_size", 24)
    layer.add_child(title)

    state_label = Label.new()
    state_label.text = "IDLE"
    state_label.position = Vector2(24, 56)
    state_label.add_theme_font_size_override("font_size", 16)
    state_label.modulate = Color(0.90, 0.76, 0.38)
    layer.add_child(state_label)

    joy_base = Control.new()
    joy_base.size = Vector2(172, 172)
    joy_base.mouse_filter = Control.MOUSE_FILTER_IGNORE
    var base_style := StyleBoxFlat.new()
    base_style.bg_color = Color(1, 1, 1, 0.08)
    base_style.border_color = Color(1, 1, 1, 0.20)
    base_style.set_border_width_all(2)
    base_style.set_corner_radius_all(86)
    var base_panel := Panel.new()
    base_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    base_panel.add_theme_stylebox_override("panel", base_style)
    joy_base.add_child(base_panel)
    layer.add_child(joy_base)

    joy_knob = Control.new()
    joy_knob.size = Vector2(72, 72)
    joy_knob.mouse_filter = Control.MOUSE_FILTER_IGNORE
    var knob_style := StyleBoxFlat.new()
    knob_style.bg_color = Color(1, 1, 1, 0.22)
    knob_style.border_color = Color(1, 1, 1, 0.34)
    knob_style.set_border_width_all(2)
    knob_style.set_corner_radius_all(36)
    var knob_panel := Panel.new()
    knob_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    knob_panel.add_theme_stylebox_override("panel", knob_style)
    joy_knob.add_child(knob_panel)
    layer.add_child(joy_knob)

    var look_hint := Label.new()
    look_hint.text = "SAĞ EKRAN: SERBEST BAKIŞ"
    look_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    look_hint.add_theme_font_size_override("font_size", 14)
    look_hint.modulate = Color(1, 1, 1, 0.55)
    look_hint.set_anchors_preset(Control.PRESET_TOP_RIGHT)
    look_hint.position = Vector2(-310, 26)
    look_hint.size = Vector2(280, 28)
    layer.add_child(look_hint)

    _layout_hud()

func _layout_hud() -> void:
    if not joy_base or not joy_knob:
        return
    var s := get_viewport().get_visible_rect().size
    var center := Vector2(125, s.y - 125)
    joy_base.position = center - joy_base.size * 0.5
    joy_knob.position = center - joy_knob.size * 0.5

func _input(event: InputEvent) -> void:
    var size := get_viewport().get_visible_rect().size

    if event is InputEventScreenTouch:
        if event.pressed:
            if event.position.x < size.x * 0.46 and event.position.y > size.y * 0.38 and move_touch == -1:
                move_touch = event.index
                move_origin = event.position
                _set_move_from_touch(event.position)
            elif event.position.x >= size.x * 0.42 and look_touch == -1:
                look_touch = event.index
        else:
            if event.index == move_touch:
                move_touch = -1
                move_vec = Vector2.ZERO
                _update_joystick_visual()
            if event.index == look_touch:
                look_touch = -1

    elif event is InputEventScreenDrag:
        if event.index == move_touch:
            _set_move_from_touch(event.position)
        elif event.index == look_touch:
            yaw -= event.relative.x * LOOK_SENS
            pitch = clamp(pitch - event.relative.y * LOOK_SENS, deg_to_rad(-38), deg_to_rad(22))
            camera_pivot.rotation = Vector3(pitch, yaw, 0)

func _set_move_from_touch(pos: Vector2) -> void:
    var delta := pos - move_origin
    if delta.length() > JOY_RADIUS:
        delta = delta.normalized() * JOY_RADIUS
    move_vec = Vector2(delta.x / JOY_RADIUS, -delta.y / JOY_RADIUS)
    _update_joystick_visual()

func _update_joystick_visual() -> void:
    if not joy_base or not joy_knob:
        return
    var center := joy_base.position + joy_base.size * 0.5
    var offset := Vector2(move_vec.x, -move_vec.y) * 48.0
    joy_knob.position = center + offset - joy_knob.size * 0.5

func _physics_process(delta: float) -> void:
    if not player:
        return

    if not player.is_on_floor():
        player.velocity.y -= GRAVITY * delta
    else:
        player.velocity.y = -0.25

    var input_len := move_vec.length()
    if input_len > 0.06:
        # Camera-relative TPS movement:
        # up = camera forward, down = camera backward,
        # right = screen right, left = screen left.
        var forward := Vector3(-sin(yaw), 0, -cos(yaw))
        var right := Vector3(cos(yaw), 0, -sin(yaw))
        var dir := right * move_vec.x + forward * move_vec.y
        if dir.length() > 1.0:
            dir = dir.normalized()

        var running := input_len > 0.84 and move_vec.y > 0.45
        var speed := RUN_SPEED if running else WALK_SPEED
        player.velocity.x = dir.x * speed
        player.velocity.z = dir.z * speed
        player.rotation.y = yaw

        if running:
            _play_state("run", 1.0)
            state_label.text = "RUN"
        elif move_vec.y < -0.35:
            _play_state("walk", -0.85)
            state_label.text = "BACKWARD"
        elif abs(move_vec.x) > 0.50 and abs(move_vec.y) < 0.65:
            _play_state("walk", 0.88)
            state_label.text = "STRAFE"
        else:
            _play_state("walk", 1.0)
            state_label.text = "WALK"
    else:
        player.velocity.x = move_toward(player.velocity.x, 0.0, 18.0 * delta)
        player.velocity.z = move_toward(player.velocity.z, 0.0, 18.0 * delta)
        _play_state("idle", 1.0)
        state_label.text = "IDLE"

    player.move_and_slide()
    camera_pivot.global_position = player.global_position + Vector3(0, 1.28, 0)

func _find_animation_player(node: Node) -> AnimationPlayer:
    if node is AnimationPlayer:
        return node as AnimationPlayer
    for child in node.get_children():
        var found := _find_animation_player(child)
        if found:
            return found
    return null

func _index_animations() -> void:
    if not animation_player:
        return
    for library_name in animation_player.get_animation_library_list():
        var lib := animation_player.get_animation_library(library_name)
        for anim_name in lib.get_animation_list():
            var key := String(anim_name).to_lower()
            if "idle" in key and not anim_map.has("idle"):
                anim_map["idle"] = StringName(anim_name)
            elif "run" in key and not anim_map.has("run"):
                anim_map["run"] = StringName(anim_name)
            elif "walk" in key and not anim_map.has("walk"):
                anim_map["walk"] = StringName(anim_name)

func _play_state(state: String, speed: float) -> void:
    if not animation_player or not anim_map.has(state):
        return
    var name: StringName = anim_map[state]
    if animation_player.current_animation != String(name):
        if speed < 0:
            animation_player.play(name, 0.18, abs(speed), true)
        else:
            animation_player.play(name, 0.18, speed)
    else:
        animation_player.speed_scale = speed
