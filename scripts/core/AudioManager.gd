# AudioManager.gd
# Dynamic Audio & Soundscape Manager for NilamburWorld
extends Node

@onready var music_player: AudioStreamPlayer = AudioStreamPlayer.new()
@onready var ambient_player: AudioStreamPlayer = AudioStreamPlayer.new()
@onready var sfx_player: AudioStreamPlayer = AudioStreamPlayer.new()

var is_muted: bool = false

func _ready():
	add_child(music_player)
	add_child(ambient_player)
	add_child(sfx_player)
	print("[AudioManager] Audio Manager initialized.")

func play_background_music(stream_path: String):
	if ResourceLoader.exists(stream_path):
		var stream = load(stream_path)
		music_player.stream = stream
		music_player.play()

func play_ambient_rain():
	print("[AudioManager] Playing Monsoon Rain soundscape...")

func play_ambient_river():
	print("[AudioManager] Playing Chaliyar River ambience...")

func play_sfx(stream_path: String):
	if ResourceLoader.exists(stream_path):
		sfx_player.stream = load(stream_path)
		sfx_player.play()
