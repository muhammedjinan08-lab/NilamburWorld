# QuestManager.gd
# Quest Tracker and Story Objectives for NilamburWorld
extends Node

signal quest_updated(quest_id: String, is_completed: bool)

var quests: Dictionary = {
	"quest_conolly": {
		"title": "The Teak Heritage",
		"description": "Locate Conolly's Plot and discover the giant 180-year-old Teak tree.",
		"completed": false,
		"reward_points": 250
	},
	"quest_bridge": {
		"title": "Cross the Chaliyar",
		"description": "Walk across the historical Canoly Suspension Bridge over Chaliyar River.",
		"completed": false,
		"reward_points": 150
	},
	"quest_museum": {
		"title": "Teak Scholar",
		"description": "Visit the Nilambur Teak Museum and inspect the historic wood carving exhibits.",
		"completed": false,
		"reward_points": 200
	},
	"quest_waterfall": {
		"title": "Adyanpara Cascade",
		"description": "Explore the lush waterfall of Adyanpara in the Nilambur forest range.",
		"completed": false,
		"reward_points": 300
	},
	"quest_palace": {
		"title": "Royal Manor",
		"description": "Visit Nilambur Kovilakam (Palace) and learn about the local heritage.",
		"completed": false,
		"reward_points": 200
	}
}

func complete_quest(quest_id: String):
	if quests.has(quest_id) and not quests[quest_id]["completed"]:
		quests[quest_id]["completed"] = true
		var reward = quests[quest_id]["reward_points"]
		if GameManager:
			GameManager.add_score(reward)
		emit_signal("quest_updated", quest_id, true)
		print("[QuestManager] Quest Completed: ", quests[quest_id]["title"], " (+", reward, " pts)")

func get_quest_progress() -> Dictionary:
	var total = quests.size()
	var done = 0
	for key in quests:
		if quests[key]["completed"]:
			done += 1
	return {"completed": done, "total": total, "percent": float(done) / float(total) * 100.0}
