# GameManager.gd
# Core singleton for NilamburWorld open-world game
extends Node

signal score_updated(new_score: int)
signal quest_completed(quest_id: String)
signal weather_changed(new_weather: String)
signal location_discovered(location_name: String)

var player_name: String = "Explorer"
var current_score: int = 0
var discovered_locations: Array = []
var completed_quests: Array = []
var is_multiplayer_active: bool = false

var weather_states = ["Sunny", "Monsoon Rain", "Teak Forest Mist", "Golden Sunset"]
var current_weather: String = "Sunny"

var game_settings = {
	"audio_master": 0.8,
	"audio_music": 0.7,
	"audio_sfx": 0.9,
	"graphics_quality": "High",
	"draw_distance": 1500.0,
	"shadow_quality": "High"
}

func _ready():
	print("[GameManager] Initializing NilamburWorld Core Manager...")
	load_game_settings()

func load_game_settings():
	var config = ConfigFile.new()
	var err = config.load("user://settings.cfg")
	if err == OK:
		game_settings["audio_master"] = config.get_value("audio", "master", 0.8)
		game_settings["graphics_quality"] = config.get_value("graphics", "quality", "High")

func save_game_settings():
	var config = ConfigFile.new()
	config.set_value("audio", "master", game_settings["audio_master"])
	config.set_value("graphics", "quality", game_settings["graphics_quality"])
	config.save("user://settings.cfg")

func discover_location(loc_name: String):
	if not discovered_locations.has(loc_name):
		discovered_locations.append(loc_name)
		add_score(100)
		emit_signal("location_discovered", loc_name)
		print("[GameManager] Discovered new location: ", loc_name)

func add_score(amount: int):
	current_score += amount
	emit_signal("score_updated", current_score)

func set_weather(weather_name: String):
	if weather_states.has(weather_name):
		current_weather = weather_name
		emit_signal("weather_changed", weather_name)
