# Westeros: version history

Updated whenever a major change ships. Newest first.

## v1.1.6 (Nov 6, 2026)
- **Bots understand who is doing what.** "I will send you 5 gold" is now an offer (they thank you), not a request for money. Messages are read clause by clause, so several things in one message are all understood.
- **Caught spies.** Tell a bot you caught its spies and it admits, denies or defies you, depending on whether its spies really were caught and on its personality.
- **Specific threats.** Threatening to attack, label them a traitor (carries weight only from the king), break an alliance or expose them each get a different answer.
- **Ultimatums.** "If you don't give me 5 gold, I'm going to attack you" is weighed against your strength and their pride: they may pay under protest, stall, or defy and turn hostile.
- Announcing an attack on someone else gets a reaction based on whether that house is their ally or enemy.

## v1.1.5 (Nov 6, 2026)
- **Bots no longer fake loyalty to an attacker.** Once a house marches on a bot's city (or its spies see the army coming), the bot treats that house as an enemy for several rounds: it refuses alliances, treaties, gifts, help and requests to follow, answers coldly, and stops starting friendly conversations with them.
- **Bots no longer ask the king what they think of the king.** Questions about the crown are skipped for the king, and talk about the crown is addressed to them directly.

## v1.1.4 (Nov 6, 2026)
- **Secret messages to bots.** Bots now appear in the private-message recipient list, so you can message them secretly (and include them under "Everyone").

## v1.1.3 (Nov 6, 2026)
- **More natural bots.** Bots now talk like people instead of repeating house words: they answer greetings, "how are you", questions about their plans (honestly or not), "why", the king, insults and trust talk, with a warmer or colder tone depending on how they feel about you. House mottos are rare now.
- **They answer and ask.** Bots answer anything sent to them, join in on about half of public chat (one bot per message), and sometimes ask questions back or start a conversation, about your plans, who you worry about, the king, or alliances. Your answers can feed into what they think.
- **Royal decrees.** A bot that gets a demand from the king may pay (often with a note), say it will pay later (and then do, once it can afford it), say it cannot afford it, plead poverty falsely, or openly defy the crown, in private or sometimes in public. Defiance costs the king's trust.

## v1.1.2 (Nov 6, 2026)
- **Ships sail through water.** Fleets now follow the real coastline: the shortest route through open sea between two cities, plus a short march if a city is inland. Ships travel at 1200 map units per round (infantry 300, dragons 700), so they beat armies on most trips, though sailing around the whole continent can still take a round or two.
- **Sand-blue sea.** The war map's water is now a sand blue instead of parchment, and the internal region borders are clipped to the land.
- **Watch the dice.** Every siege battle's dice animation now plays for the whole table, not just the houses involved, and the Battles list in the reports page has a "Watch the dice" button to replay recent battles.

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
