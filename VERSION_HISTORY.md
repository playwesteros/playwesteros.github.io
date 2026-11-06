# Westeros: version history

Updated whenever a major change ships. Newest first.

## v1.1.1 (Nov 6, 2026)
- **Smarter bots.** Bots now understand plain-language requests in chat: ask for gold, troops, an attack on a house or city, help, peace, their spy intel, or to follow you. They decide using trust, alliances, their stance toward you, the king's crown and a random buffer, and they can say yes, say no, or lie.
- **Spying and intel.** Bots send spies every round, read the reports (army counts, marches, secret pacts, intercepted ravens) and share valuable finds with allies. They can also hold back or lie to help themselves, and catch lies that contradict their own spies.
- **Reactions.** Bots respond when their spies are caught, when branded a traitor, when an ally breaks a pact, when attacked or besieged (they call allies for help), and warm to gifts. A bot king brands traitors by grudge.
- **Plans and loyalty.** Each round a bot picks a goal (build, conquer, defend, support, betray, hold) and, for every house, decides whether following or betraying pays better, with a randomized buffer. A bot betraying an ally breaks the alliance before attacking. Bots also ask allies for gold, troops, help and joint attacks.
- **Attack fixes.** Bots only attack cities that are live this round (held by a player still in the game, or the empty throne), they estimate their odds with the siege dice rules, keep a home guard, and no longer cap recruiting at 10. Fixed the home-city check bug.

## v1.1.0 (Nov 6, 2026)
- **Siege mechanics.** Attacks now lay siege to a city instead of resolving in one roll. Every court, each unit on both sides rolls a die (dragons add +3). Each side's dice are lined up from highest to lowest and compared in pairs: the higher roll wins and the loser's unit is lost, ties go to the defenders, and dice with no opponent are discarded. The siege goes on, round after round, until one side has no units left.
- Defenders are the city's garrison (its defense value, plus the +2 house buffs), the owner's home army, and any relief armies. Surviving attackers and relief armies march home when the siege ends.
- **No income while besieged.** A city pays nothing to anyone until the siege ends or is lifted.
- **Relief armies.** Allies (or teammates) can send an army to a besieged city and add their dice to the defenders. Attackers can withdraw at any time during the action phase.
- **Dice animation.** Each battle plays out as a popup: the dice tumble, sort from highest to lowest, then clash pair by pair, with a casualty summary at the end.
- The map marks besieged cities, and the war panel shows your armies at sieges.

## v1.0.9 (Nov 6, 2026)
- **Travel takes time based on distance.** An attack's travel time now comes from the straight-line map distance between the attacker's city and the target. Infantry cover 300 map units per round, ships 450, dragons 700, rounded up to whole rounds. A mixed force arrives with its slowest unit. The attack form shows the travel time before you commit.
- **House buffs on the house-choice screen.** The buff appears under the house's motto when you hover or preview a house (hidden when the host turns buffs off).
- In-game screen fits the window with no page scrolling. The bottom Leave game and War map buttons are gone (Leave game is in the throne menu, the war map is in Army).

## v1.0.8 (Nov 6, 2026)
- **Ready buttons.** Players press Ready in the top bar; the host's button shows the ready count. New host setting: host must wait for everyone, host may move on early with a confirmation (default), or no ready buttons.
- **No more resolution page.** Ending court goes straight into the next round, and every player gets a start-of-round report popup: income, upkeep, ships completed, deserters, and treasury change.
- Recruit as many units as you can afford (the quantity wheel stops at what you can afford). Spy gold wheel stops at 20 or what you can afford. Dragons can no longer be disbanded.
- Changing your name mid-game now takes effect after the game ends.
- Game type comes before player limit on the host's setup screen.

## v1.0.7 and earlier
- Host advanced game settings (disable alliances, the Hand, house buffs, individual popups and houses; round time limit; kick and mute) and a personal settings dropdown on the throne corner.
- Popup overhaul: back-to-back transitions, one popup per event, siege and sack popups, new-king flow that opens the decree tab for the Hand appointment, red outline only for negative popups, trimmed backlog after being away.
- Hand's Ledger moved into Relations in place of the taxes button; simplified menu headers; new transparent browser icon; black fade-in for the throne room.
