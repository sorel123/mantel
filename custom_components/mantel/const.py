"""Constants for the Mantel integration."""

from datetime import timedelta

DOMAIN = "mantel"
CONF_TOKEN = "token"
SCAN_INTERVAL = timedelta(seconds=30)

EVENT_CHORE_DONE = "mantel_chore_done"
EVENT_REWARD_REDEEMED = "mantel_reward_redeemed"
EVENT_SAID = "mantel_said"
ACTIVITY_EVENTS = {
    "chore_done": EVENT_CHORE_DONE,
    "reward_redeemed": EVENT_REWARD_REDEEMED,
    "said": EVENT_SAID,
}

SERVICE_SAY = "say"
SERVICE_ADD_ITEM = "add_item"
SERVICE_POST_NOTE = "post_note"
