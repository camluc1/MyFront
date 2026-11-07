# FRONTIER Geopolitics

Geopolitics is a separate **offline** ruleset (`GameConfig.geopolitics`, Singleplayer only). The menu keeps Classic and offers Geopolitics immediately below it. Configuration states the victory rule and removes the incompatible classic alliance-duration and match-timer controls.

## Shipped rules

| System           | Rule                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Ceasefire        | 60 game seconds without attacks between signatories                                                                         |
| Non-aggression   | 180 game seconds                                                                                                            |
| Negotiated peace | Immediate compensation and a 180-second agreement                                                                           |
| Coalition        | Up to four countries, 300 seconds, optional common strategic target                                                         |
| Membership       | Every existing member and the invited country must approve                                                                  |
| Victory          | A country or coalition holds at least 90% of conquerable non-fallout land for 600 consecutive simulation ticks (60 seconds) |
| Countdown        | Visible remaining seconds; falling below the threshold or changing membership restarts it                                   |
| Departure        | A 60-second truce with former partners                                                                                      |
| Betrayal         | Explicit break permits combat and records lasting distrust; nuclear strikes also record treaty breach                       |
| Offers           | Accept, reject, withdraw, counteroffer; 45-second expiry; 30-second pair cooldown                                           |
| Rate limits      | Six pending offers involving a country, 32 pending offers globally, two prominent notifications                             |

Countries keep their armies, resources, colors and construction. Coalitions share victory; they do not merge countries. Existing attack and reachability rules still apply. Nations consider their common strategic target after their normal defensive reserve checks.

## Exact transfers

Gold, troops, buildings and owned land can be offered in both directions. Selecting a building adds the owned tiles in a selectable radius; clicking the negotiation map adds further regions. Disconnected enclaves are allowed. The UI shows the exact selected tile mask, also projected onto the live map. The background mini-map is downsampled for performance; the transfer mask itself is never an approximate circle.

Offers contain explicit tile references and building IDs. Every structure within those tiles must be listed. The engine revalidates both sides before any mutation: ownership, active structures, available resources, membership, expiry, duplicate references and land validity. An ownership change or new unlisted building invalidates the entire transaction. A country must retain some land. The same building objects transfer, preserving current levels, health and construction state. Those live attributes can evolve while an offer is pending; the fixed promise is which tiles and objects transfer. Accepting an already accepted offer cannot transfer assets again.

Per-side limits are 20,000 tiles and 500 buildings. Accepted transfers happen atomically in a single deterministic execution. Pending offers, treaties, memory, coalition votes and victory progress are saved with the engine snapshot. A resumed client receives a full diplomatic resync.

## Strategic AI

No language model, online service or new media assets are required. Decisions use deterministic integer calculations: troop strength, territory, defenses, warships, active fronts, reachable common neighbors, compensation and diplomatic history. Four stable preferences distinguish expansionists, traders, pragmatists and cautious countries. Harder difficulties demand slightly better terms.

The AI can accept, reject or counter proposals and initiate peace, non-aggression or coalition offers. Credible occasional ultimatums require a border and at least twice the recipient's troops; after rejection or expiry, an AI attacks only if the military conditions still support it. Humans choose whether to follow through. Initiation is staggered to one country per ten game seconds rather than evaluating every country every tick. Tribes respond through the same validation and evaluation path; strategic initiation is reserved for nations.

Memory records attacks, agreements, completed treaties, aid and betrayal. Minor trust changes gradually soften; betrayal counts persist for the match, including saved games. The decision explanation is shown in the offer. Aid can also be sent directly from the coalition panel.

## UI and resource use

The diplomatic desk contains countries, inbox, allies and history. Negotiation has separate offer/request columns, resource quantities, building levels and coordinates, map selection, exact transfer highlights and approval status. Alerts do not pause play or open dialogs automatically. No textures, models, audio or external dependency packages were added. Large map preview backgrounds are capped at 512 pixels in width. Full diplomatic updates are emitted only when their serialized state changes; graphical relation uploads change only when treaty membership changes.

## Validation

- Engine tests cover isolated transfers, preservation of structures, insufficient funds, changed ownership, hidden new buildings, duplicate acceptance, unauthorized acceptance, counteroffers, unanimous membership and maximum coalition size.
- Tests cover betrayal, aid, expiry, attacks during ceasefire, common-threat reasoning, credible ultimatums, full victory holding time and countdown resets.
- Snapshot tests cover queued diplomacy actions and exact continuation after restore. A scripted match exercises AI, combat and construction for 2,400 ticks with a save/restore comparison over the last 600 ticks.
- DOM interaction tests cover selecting a building, emitting the exact tile list, acceptance, counteroffers, countdown display and overlay disposal.
- Classic full-game snapshot simulations and relevant alliance/nuclear tests are included.
- TypeScript checks and Vite build pass. No browser binary was available; the attempted Playwright browser download was truncated. Full-browser visual and manual playtesting therefore remain unverified.
- A pre-existing client action test, `does not boat-attack past the distance limit`, fails identically with the original `ClientGameRunner.ts` from the parent commit. It is unrelated to diplomacy and was not changed here.

All source changes belong on `frontier/development`. Public release should follow a real-browser visual check and playtesting of negotiation balance on representative small and large maps.
