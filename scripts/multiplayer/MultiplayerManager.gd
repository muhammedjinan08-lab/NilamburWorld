# MultiplayerManager.gd
# Multiplayer & WebRTC Networking for NilamburWorld
extends Node

signal player_connected(id: int, player_info: Dictionary)
signal player_disconnected(id: int)
signal server_disconnected

const DEFAULT_PORT: int = 7000
const MAX_PLAYERS: int = 32

var peer: ENetMultiplayerPeer
var players: Dictionary = {}

func _ready():
	multiplayer.peer_connected.connect(_on_player_connected)
	multiplayer.peer_disconnected.connect(_on_player_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_ok)
	multiplayer.connection_failed.connect(_on_connected_fail)
	multiplayer.server_disconnected.connect(_on_server_disconnected)

func host_game(port: int = DEFAULT_PORT) -> Error:
	peer = ENetMultiplayerPeer.new()
	var err = peer.create_server(port, MAX_PLAYERS)
	if err != OK:
		print("[MultiplayerManager] Failed to host server: ", err)
		return err
	multiplayer.multiplayer_peer = peer
	print("[MultiplayerManager] Server hosted on port ", port)
	return OK

func join_game(address: String = "127.0.0.1", port: int = DEFAULT_PORT) -> Error:
	peer = ENetMultiplayerPeer.new()
	var err = peer.create_client(address, port)
	if err != OK:
		print("[MultiplayerManager] Connection failed: ", err)
		return err
	multiplayer.multiplayer_peer = peer
	print("[MultiplayerManager] Connecting to ", address, ":", port)
	return OK

func _on_player_connected(id: int):
	print("[MultiplayerManager] Player joined: ", id)

func _on_player_disconnected(id: int):
	players.erase(id)
	emit_signal("player_disconnected", id)
	print("[MultiplayerManager] Player left: ", id)

func _on_connected_ok():
	print("[MultiplayerManager] Successfully connected to server.")

func _on_connected_fail():
	print("[MultiplayerManager] Could not connect to host.")

func _on_server_disconnected():
	print("[MultiplayerManager] Disconnected from server.")
	emit_signal("server_disconnected")
