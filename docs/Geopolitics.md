# FRONTIER Geopolitics

Geopolitics is a separate **offline** ruleset (`GameConfig.geopolitics`, Singleplayer only). The menu keeps Classic and offers Geopolitics immediately below it. Configuration states the victory rule and removes the incompatible classic alliance-duration and match-timer controls.

## Shipped rules

| System           | Rule                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Ceasefire        | 60 game seconds without attacks between signatories                                                                         |
| Non-aggression   | 180 game seconds                                                                                                            |
| Bilateral alliance | 300 game seconds; mutual protection without shared victory                                                               |
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

The AI can accept, reject or counter proposals and initiate peace, non-aggression, bilateral alliance or coalition offers. Bilateral alliances protect both signatories for 300 game seconds without sharing victory. Credible occasional ultimatums require a border and at least twice the recipient's strategic power; after rejection or expiry, an AI attacks only if the military conditions still support it. Humans choose whether to follow through. Strategic power includes troops, territory, treasury with diminishing returns, cities, ports, factories, farms, mines, oil and gas infrastructure, defenses, warships and missile assets. Exact land offers also account for natural-resource deposits and their remaining reserves. One nation receives an initiative slot every three game seconds, with per-country and per-pair cooldowns to prevent spam. The AI negotiates with the actual active attacker and can seek bilateral partners beyond its land borders when no immediate crisis exists. Tribes respond through the same validation and evaluation path; strategic initiation is reserved for nations.

Memory records attacks, agreements, completed treaties, aid and betrayal. Minor trust changes gradually soften; betrayal counts persist for the match, including saved games. The decision explanation is shown in the offer. Aid can also be sent directly from the coalition panel.

## UI and resource use

The diplomatic desk contains countries, inbox, allies and history. Negotiation has separate offer/request columns, resource quantities, building levels and coordinates, map selection, exact transfer highlights and approval status. New incoming proposals open the diplomatic desk directly when the player is not editing another offer. Sending a proposal and accepting an incoming offer each require a separate review/confirmation step; the review summarizes both sides, warns about surrendering the last critical building, and lists natural-resource deposits in the exact territory transfer. Country cards show explicit neutral, hostile, bilateral-treaty and coalition status. In Geopolitics only, active war borders are highlighted red and friendly treaty/coalition borders green; Classic keeps its original renderer behavior. Spanish translations are provided for the full diplomacy interface. Large map preview backgrounds are capped at 512 pixels in width. Full diplomatic updates are emitted only when their serialized state changes; graphical relation uploads change when treaty membership or active-front state changes.

## Validation

- Engine tests cover isolated transfers, preservation of structures, insufficient funds, changed ownership, hidden new buildings, duplicate acceptance, unauthorized acceptance, counteroffers, unanimous membership and maximum coalition size.
- Tests cover betrayal, aid, expiry, attacks during ceasefire, common-threat reasoning, credible ultimatums, full victory holding time and countdown resets.
- Snapshot tests cover queued diplomacy actions and exact continuation after restore. A scripted match exercises AI, combat and construction for 2,400 ticks with a save/restore comparison over the last 600 ticks.
- DOM interaction tests cover selecting a building, emitting the exact tile list, proposal review, two-step acceptance, bilateral alliance selection, counteroffers, countdown display and overlay disposal. Relation-matrix tests cover active hostility, retreating attacks and the Geopolitics-only tint.
- Classic full-game snapshot simulations and relevant alliance/nuclear tests are included.
- The earlier baseline TypeScript checks and Vite build passed. This severe Geopolitics upgrade has not yet been compiled or executed in a local browser; no GitHub Actions were run. Full-browser visual and manual balance validation remain required before calling it finished.
- A pre-existing client action test, `does not boat-attack past the distance limit`, fails identically with the original `ClientGameRunner.ts` from the parent commit. It is unrelated to diplomacy and was not changed here.

All source changes belong on `frontier/development`. Public release should follow a real-browser visual check and playtesting of negotiation balance on representative small and large maps.

## Fleet and diplomacy review

The fleet renderer now estimates heading from distinct navigation positions instead of the instantaneous interpolation velocity. Directional hysteresis suppresses grid-stair rocking, stable-course settling preserves real bearings, and real turns have a bounded angular rate. Stationary updates do not continually retarget the bow. Transport and merchant world sizes are roughly halved; warship size is reduced about 47%. Zoom-out enlargement is capped at 1.5 rather than 3, with lower screen-space minima. Hull silhouettes, country colors, cargo colors and relative wake/pulse distinctions are retained. Train and missile sizing are unchanged.

Negotiation now supports starting approaches for buying a port, securing peace, offering aid and demanding compensation. These only prepare editable drafts; buying a port never automatically selects assets. Buildings are sorted by level, can be filtered by type and located on the world map. The panel shows the share of territory being ceded, retained land, individual coalition votes and the consequences of each treaty. Invalid proposals return reasons and preserve the draft instead of silently disappearing. Counters replace existing offers even at the pending-offer limit, with a maximum of three counteroffer rounds.

New campaigns carry a saved diplomatic seed that changes country personalities and the order of AI initiatives. Old saves without the seed retain their existing personality assignment. This creates varied campaigns while keeping replay and save/restore deterministic; it does not promise every conceivable playthrough is unique. AI negotiations additionally account for distinct active attackers and nuclear capability, value retaining the final port or city, distinguish a bilateral payment from benefits to other coalition members, and can offer monetary compensation instead of surrendering land. Rejections, withdrawals and completed treaties appear in diplomatic history.

Validation includes irregular stair-step ship routes with stationary ticks, bounded real turns, stationary headings, the 10,000-ship instance-buffer test, exact infrastructure selection and draft presets, seed variation, strategic-asset valuation, counteroffer limits, explanatory errors and seeded match save/restore. The real unit shaders were rendered with headless EGL at three scales for before/after inspection (GL_NO_ERROR). This verifies the isolated shader rendering; full-browser gameplay and subjective balance still need playtesting.

## Continuous sailing correction

The earlier heading filter left the vessel position chasing independent grid steps. Planned trade and troop ships now receive a presentation-only centerline derived from their existing full navigation plan. Grid staircases are simplified within a 1.5-tile corridor, with every shortcut checked against water and original navigation tiles. Real bends receive quadratic fillets only when their samples remain navigable. Original path indexes preserve engine departure and arrival timing. Hull and wake use the tangent of this same position curve, rather than a separately drifting direction. Warships without plans use a projected course corridor and their actual rendered velocity; stationary positions still settle to their authoritative tile.

The merchant has a rounded stern, tapered forecastle, aft bridge with windows/funnel, recessed working deck and separated cargo bays in honey, muted teal and terracotta. The country-colored hull and the compact fleet scales remain. No assets or per-ship draw calls were added.

Validation includes zero lateral motion/yaw on both one-cell and two-cell diagonal staircases, coherent curve tangents at real turns, no land-obstacle shortcuts, original plan timing, the actual fleet instance buffer receiving the new route, unplanned-warship stability and the existing 10,000-unit batch test. A controlled before/after animation uses the actual GPU shaders; it is not a recording of a full browser match.


## Diplomatic council V2 (November 2026)

This iteration makes diplomacy **decision-first** while preserving the simulation ruleset and Classic game:
- Incoming offers open with the proposer, treaty type, real term duration, the current player's actual gains/losses, a reserve-troop comparison and exact territory highlights. The older full editor is collapsed by default.
- The summary accounts for **coalition third-party approvers**, who vote but do not personally pay or receive the bilateral deal's assets. Coalition members, approvals, shared target and duration are shown.
- Geographic selection remains exact, with zero-radius single-tile selection, larger brush selection, clearing either side, and transferred-port tile/building ownership.
- Quantified asset-share indicators state the percentage of the **owner's** ports, cities, mines, oil wells, gas plants, farms, factories, defense posts, SAMs, silos, gold, troops and land included in the proposed deal. Resource sites and quality display when affected. These are factual asset shares, **not simulated market prices**.
- PlayerPanel (opened by right click) provides Negotiate, Demand Territory, Form Coalition, and Treaties & Info. PlayerInfoOverlay has a negotiation shortcut. A treaty dossier shows current relationship, bilateral treaty and time remaining, bloc membership, objective and pending deals.
- Peace proposals may specify 1800 or 3000 simulation ticks (3 or 5 minutes); the selected duration is persisted with the offer, transmitted as an optional action field, preserved by counteroffers and applied on acceptance. Older offers retain the three-minute default.
- New strings for the council are localized in Spanish and English. Other supported languages can fall back to English where translations are unavailable.
- Negotiation previews and the overlay use colors from the **viewing player's** perspective. Previous sender-viewpoint colors could misstate received and ceded land.

### QA before release
Focused tests added for duration, snapshot, contextual opening, exact asset impact, sender/recipient perspective and third-party coalition voting. As of authoring, those test files are **committed but not executed** in this environment. Run typecheck, Vite build, Geopolitics engine tests, panel interaction tests, save/restore, and manual checks in the browser at various resolutions, particularly right-click menus and territory editing. This release must not be called fully validated until they pass.
