extends Node3D

var character_root: Node3D
var male_scene: PackedScene
var female_scene: PackedScene
var selected_gender := 0
var selected_mode := "TEKLİ"
var current_outfit := 0
var current_hair := 0
var current_hat := 0
var current_pack := 0
var current_weapon := 0

var camera: Camera3D
var title_label: Label
var status_label: Label
var start_button: Button
var rotate_hint: Label
var accessory_root: Node3D

var touches := {}
var last_pinch_distance := 0.0
var yaw := 0.0
var zoom := 4.1

var outfit_colors := [
	Color(0.055, 0.065, 0.09),
	Color(0.035, 0.10, 0.19),
	Color(0.11, 0.075, 0.055),
	Color(0.075, 0.085, 0.07)
]
var hair_colors := [
	Color(0.025,0.02,0.018),
	Color(0.12,0.055,0.025),
	Color(0.025,0.035,0.07)
]

func _ready():
	_build_stage()
	_load_models()
	_build_ui()
	_show_character(0)

func _build_stage():
	var env_node := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.018, 0.022, 0.035)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.20,0.22,0.30)
	env.ambient_light_energy = 1.35
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env_node.environment = env
	add_child(env_node)

	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-38,-28,0)
	key.light_energy = 2.4
	key.light_color = Color(1.0,0.82,0.72)
	key.shadow_enabled = true
	add_child(key)

	var fill := OmniLight3D.new()
	fill.position = Vector3(-2.8,2.1,2.4)
	fill.light_color = Color(0.18,0.32,0.75)
	fill.omni_range = 8.0
	fill.light_energy = 4.0
	add_child(fill)

	var rim := OmniLight3D.new()
	rim.position = Vector3(2.3,2.4,-1.8)
	rim.light_color = Color(0.75,0.05,0.06)
	rim.omni_range = 7.0
	rim.light_energy = 3.4
	add_child(rim)

	camera = Camera3D.new()
	camera.position = Vector3(0,1.35,zoom)
	camera.fov = 43.0
	add_child(camera)
	camera.look_at(Vector3(0,1.05,0), Vector3.UP)

	var floor := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(14,10)
	floor.mesh = plane
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.035,0.04,0.055)
	fm.metallic = 0.35
	fm.roughness = 0.42
	floor.material_override = fm
	add_child(floor)

	var podium := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.25
	cyl.bottom_radius = 1.45
	cyl.height = 0.22
	cyl.radial_segments = 64
	podium.mesh = cyl
	podium.position.y = 0.11
	var pm := StandardMaterial3D.new()
	pm.albedo_color = Color(0.10,0.11,0.15)
	pm.metallic = 0.8
	pm.roughness = 0.18
	podium.material_override = pm
	add_child(podium)

	character_root = Node3D.new()
	character_root.name = "CharacterRoot"
	character_root.position.y = 0.22
	add_child(character_root)

	accessory_root = Node3D.new()
	accessory_root.name = "Accessories"
	character_root.add_child(accessory_root)

func _load_models():
	male_scene = load("res://assets/characters/Superhero_Male_FullBody.gltf")
	female_scene = load("res://assets/characters/Superhero_Female_FullBody.gltf")

func _show_character(gender:int):
	selected_gender = gender
	for c in character_root.get_children():
		if c != accessory_root:
			c.queue_free()
	for c in accessory_root.get_children():
		c.queue_free()

	var packed := male_scene if gender == 0 else female_scene
	if packed == null:
		status_label.text = "3D model yüklenemedi"
		return

	var inst := packed.instantiate()
	inst.name = "MaleCharacter" if gender == 0 else "FemaleCharacter"
	character_root.add_child(inst)
	character_root.move_child(accessory_root, character_root.get_child_count()-1)
	_fit_model(inst)
	_apply_character_style()
	_refresh_accessories()
	if status_label:
		status_label.text = ("ERKEK • ANA KARAKTER" if gender == 0 else "KADIN • ALTERNATİF")

func _fit_model(inst:Node3D):
	# Quaternius rigged base characters are authored in game-scale units.
	inst.scale = Vector3.ONE
	inst.position = Vector3.ZERO
	inst.rotation_degrees.y = 180

func _apply_character_style():
	var outfit: Color = outfit_colors[current_outfit % outfit_colors.size()]
	var hair: Color = hair_colors[current_hair % hair_colors.size()]
	_apply_materials_recursive(character_root, outfit, hair)

func _apply_materials_recursive(n:Node, outfit:Color, hair:Color):
	if n is MeshInstance3D:
		var mi := n as MeshInstance3D
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var original := mi.mesh.surface_get_material(i)
				if original:
					var mat := original.duplicate()
					var rn := original.resource_name.to_lower()
					if mat is BaseMaterial3D:
						var bm := mat as BaseMaterial3D
						if "hair" in rn:
							bm.albedo_color = hair
						elif "superhero" in rn:
							bm.albedo_color = outfit
					mi.set_surface_override_material(i, mat)
	for child in n.get_children():
		_apply_materials_recursive(child, outfit, hair)

func _refresh_accessories():
	for c in accessory_root.get_children():
		c.queue_free()

	if current_hat > 0:
		var hat := Node3D.new()
		var brim := MeshInstance3D.new()
		var brim_mesh := CylinderMesh.new()
		brim_mesh.top_radius = 0.40
		brim_mesh.bottom_radius = 0.40
		brim_mesh.height = 0.035
		brim_mesh.radial_segments = 48
		brim.mesh = brim_mesh
		brim.position = Vector3(0,1.73,0)
		hat.add_child(brim)
		var crown := MeshInstance3D.new()
		var crown_mesh := CylinderMesh.new()
		crown_mesh.top_radius = 0.22
		crown_mesh.bottom_radius = 0.27
		crown_mesh.height = 0.23
		crown_mesh.radial_segments = 48
		crown.mesh = crown_mesh
		crown.position = Vector3(0,1.86,0)
		hat.add_child(crown)
		var hm := StandardMaterial3D.new()
		hm.albedo_color = Color(0.02,0.025,0.035)
		hm.metallic = 0.25
		hm.roughness = 0.28
		brim.material_override = hm
		crown.material_override = hm
		accessory_root.add_child(hat)

	if current_pack > 0:
		var pack := MeshInstance3D.new()
		var cm := CapsuleMesh.new()
		cm.radius = 0.24
		cm.height = 0.72
		pack.mesh = cm
		pack.scale = Vector3(1.0,1.0,0.52)
		pack.position = Vector3(0,1.05,0.25)
		pack.rotation_degrees.x = 90
		var pm := StandardMaterial3D.new()
		pm.albedo_color = Color(0.055,0.07,0.065)
		pm.metallic = 0.15
		pm.roughness = 0.7
		pack.material_override = pm
		accessory_root.add_child(pack)

	if current_weapon > 0:
		var gun := Node3D.new()
		gun.position = Vector3(0.35,1.20,0.22)
		gun.rotation_degrees = Vector3(12,0,-18)
		var barrel := MeshInstance3D.new()
		var bmesh := CylinderMesh.new()
		bmesh.top_radius = 0.035
		bmesh.bottom_radius = 0.035
		bmesh.height = 1.15
		bmesh.radial_segments = 24
		barrel.mesh = bmesh
		barrel.rotation_degrees.z = 90
		gun.add_child(barrel)
		var body := MeshInstance3D.new()
		var body_mesh := BoxMesh.new()
		body_mesh.size = Vector3(0.52,0.16,0.12)
		body.mesh = body_mesh
		body.position.x = -0.30
		gun.add_child(body)
		var gm := StandardMaterial3D.new()
		gm.albedo_color = Color(0.025,0.028,0.032)
		gm.metallic = 0.72
		gm.roughness = 0.25
		barrel.material_override = gm
		body.material_override = gm
		accessory_root.add_child(gun)

func _build_ui():
	var layer := CanvasLayer.new()
	add_child(layer)

	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(root)

	var top := VBoxContainer.new()
	top.position = Vector2(44,34)
	root.add_child(top)

	title_label = Label.new()
	title_label.text = "ŞAOMİ BATTLE ROYALE"
	title_label.add_theme_font_size_override("font_size",42)
	top.add_child(title_label)

	status_label = Label.new()
	status_label.text = "ERKEK • ANA KARAKTER"
	status_label.add_theme_font_size_override("font_size",22)
	status_label.modulate = Color(0.84,0.86,0.92)
	top.add_child(status_label)

	rotate_hint = Label.new()
	rotate_hint.text = "Karakteri parmakla çevir • İki parmakla yakınlaştır/uzaklaştır"
	rotate_hint.position = Vector2(44,980)
	rotate_hint.add_theme_font_size_override("font_size",18)
	rotate_hint.modulate = Color(0.72,0.75,0.82)
	root.add_child(rotate_hint)

	var gender_row := HBoxContainer.new()
	gender_row.position = Vector2(44,190)
	gender_row.add_theme_constant_override("separation",12)
	root.add_child(gender_row)
	var male_btn := _make_button("ERKEK")
	male_btn.pressed.connect(func(): _show_character(0))
	gender_row.add_child(male_btn)
	var female_btn := _make_button("KADIN")
	female_btn.pressed.connect(func(): _show_character(1))
	gender_row.add_child(female_btn)

	var menu := VBoxContainer.new()
	menu.position = Vector2(1440,170)
	menu.custom_minimum_size = Vector2(400,0)
	menu.add_theme_constant_override("separation",12)
	root.add_child(menu)

	menu.add_child(_section("KARAKTER ÖZELLEŞTİR"))
	menu.add_child(_cycle_button("YÜZ / KARAKTER", func(): _show_character(1-selected_gender)))
	menu.add_child(_cycle_button("SAÇ RENGİ", func():
		current_hair = (current_hair+1)%hair_colors.size()
		_apply_character_style()
	))
	menu.add_child(_cycle_button("KIYAFET", func():
		current_outfit = (current_outfit+1)%outfit_colors.size()
		_apply_character_style()
	))
	menu.add_child(_cycle_button("ŞAPKA / KASK", func():
		current_hat = 1-current_hat
		_refresh_accessories()
	))
	menu.add_child(_cycle_button("SIRT ÇANTASI", func():
		current_pack = 1-current_pack
		_refresh_accessories()
	))
	menu.add_child(_cycle_button("SİLAH", func():
		current_weapon = 1-current_weapon
		_refresh_accessories()
	))

	menu.add_child(_section("OYUN MODU"))
	var solo := _make_button("TEKLİ")
	solo.pressed.connect(func():
		selected_mode="TEKLİ"
		status_label.text=("ERKEK" if selected_gender==0 else "KADIN")+" • TEKLİ"
	)
	menu.add_child(solo)
	var squad := _make_button("4 KİŞİLİK TAKIM")
	squad.pressed.connect(func():
		selected_mode="4 KİŞİLİK TAKIM"
		status_label.text=("ERKEK" if selected_gender==0 else "KADIN")+" • 4 KİŞİLİK TAKIM"
	)
	menu.add_child(squad)

	start_button = _make_button("OYUNA BAŞLA")
	start_button.custom_minimum_size = Vector2(380,72)
	start_button.pressed.connect(_on_start_pressed)
	menu.add_child(start_button)

func _section(text:String)->Label:
	var l:=Label.new()
	l.text=text
	l.add_theme_font_size_override("font_size",21)
	l.modulate=Color(0.92,0.73,0.34)
	return l

func _make_button(text:String)->Button:
	var b:=Button.new()
	b.text=text
	b.custom_minimum_size=Vector2(178,52)
	b.add_theme_font_size_override("font_size",18)
	return b

func _cycle_button(text:String, cb:Callable)->Button:
	var b:=_make_button(text+"  ›")
	b.custom_minimum_size=Vector2(380,52)
	b.pressed.connect(cb)
	return b

func _on_start_pressed():
	var who := "ERKEK" if selected_gender == 0 else "KADIN"
	status_label.text = who+" • "+selected_mode+" • KARAKTER HAZIR"
	start_button.text = "EŞLEŞME HAZIR"
	start_button.disabled = true
	await get_tree().create_timer(1.4).timeout
	start_button.disabled = false
	start_button.text = "OYUNA BAŞLA"

func _process(_delta):
	character_root.rotation_degrees.y = yaw
	camera.position = Vector3(0,1.35,zoom)
	camera.look_at(Vector3(0,1.05,0),Vector3.UP)

func _input(event):
	if event is InputEventScreenTouch:
		if event.pressed:
			touches[event.index]=event.position
		else:
			touches.erase(event.index)
			last_pinch_distance=0.0
	elif event is InputEventScreenDrag:
		touches[event.index]=event.position
		if touches.size()==1:
			yaw += event.relative.x * 0.28
		elif touches.size()>=2:
			var pts:=touches.values()
			var dist:float=pts[0].distance_to(pts[1])
			if last_pinch_distance>0:
				zoom=clamp(zoom-(dist-last_pinch_distance)*0.006,2.7,5.7)
			last_pinch_distance=dist
	elif event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		yaw += event.relative.x*0.25
	elif event is InputEventMouseButton:
		if event.button_index==MOUSE_BUTTON_WHEEL_UP and event.pressed:
			zoom=clamp(zoom-0.2,2.7,5.7)
		elif event.button_index==MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			zoom=clamp(zoom+0.2,2.7,5.7)
