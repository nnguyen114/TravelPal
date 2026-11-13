# Collaborative AI Travel Planner — Product & UX Specification

**Status:** Product brainstorming baseline  
**Scope:** Agreed product features and UI/UX decisions; no technology stack or system architecture selected.

## 1. Product Vision

A trip-first collaborative travel planner where people collect destinations, organize realistic multi-day itineraries using AI, collaborate through direct edits or optional proposals, and request personalized place recommendations when they want them.

**Product principles**
- **User control:** AI proposes changes; people decide whether to apply them.
- **Flexible collaboration:** Direct edits, proposals, and saved ideas coexist. No mandatory approval process.
- **Useful AI, not intrusive AI:** Optimization and place discovery are user-initiated. No unsolicited destination suggestions.
- **Simple logistics:** Optimize by geographic convenience and distance, not transportation mode or turn-by-turn routing.
- **Trip-first, not social-feed-first:** Invite collaborators by link; no friends list or follower system.
- **Transparent, reversible changes:** Preview AI edits, keep activity history, and allow undo/recovery.
- **Low-friction entry:** No mandatory taste questionnaire or complicated onboarding.

## 2. Primary Navigation

```text
Travel App
├── My Trips (dashboard)
│   ├── Create Trip
│   ├── Join Trip (invitation link)
│   └── Trip cards (created and joined)
└── Trip Workspace
    ├── Main Trip / Itinerary (map + day-by-day plan)
    ├── Destinations (scheduled / unscheduled)
    ├── Suggestions (open / merged / closed)
    ├── Members (invite link)
    ├── Activity History
    └── Trip Settings

Persistent within trip: on-demand, collapsible AI assistant
```

**Navigation simplification:** The main trip page *is* the itinerary overview; do not create redundant Overview and Itinerary pages.

## 3. My Trips Dashboard

### Content
- Show trips the user created and trips they joined.
- Each card displays cover image or visual, trip name, destination(s), dates, and member count.
- Primary actions: **Create Trip**, **Join Trip**, **Open Trip**.
- Clicking a trip opens its workspace.
- Account/profile control can be minimal; no social profile or friend graph required.

### Example layout
```text
┌────────────────────────────────────────────────────────────┐
│ Travel App                                      Account    │
│ My Trips                                [+ Create Trip]   │
│                                         [Join via Link]   │
│ ┌───────────────────┐ ┌───────────────────┐               │
│ │ Japan 2027        │ │ Korea 2027        │               │
│ │ Jun 10–17         │ │ Jul 5–12          │               │
│ │ 5 members         │ │ 3 members         │               │
│ │ [Open Trip]       │ │ [Open Trip]       │               │
│ └───────────────────┘ └───────────────────┘               │
└────────────────────────────────────────────────────────────┘
```

## 4. Trip Creation & Multi-City Setup

### Minimal create flow
1. Enter **trip name**.
2. Enter **destination** (one city initially is sufficient).
3. Select **start/end dates**.
4. Select **Create Trip** to enter the workspace.

Do not require travel-style quizzes, friend setup, transportation choices, or detailed itinerary setup. Users can add cities and details later.

### Multi-city support
- One trip may cover multiple cities (e.g., Tokyo, Kyoto, Osaka).
- **Manually assigned:** Users specify which dates belong to which cities; AI preserves that allocation.
- **AI-suggested:** Users provide cities and trip duration; AI proposes a day allocation for review.
- **Partially fixed:** Some city dates are locked, while remaining dates are flexible.
- Users can edit or lock city allocations; AI must not silently move fixed dates.
- Multi-city suggestions are previews, not automatic edits.

## 5. Main Trip Workspace — UI/UX

### Desktop
- **Left:** Scrollable day-by-day itinerary and trip controls.
- **Right:** Sticky interactive map showing the route/order of destinations.
- **AI assistant:** Collapsible side panel or drawer, closed by default; opens when invoked.
- Header: trip name, dates, city/cities, member avatars, **Invite** action, trip tabs.
- Key actions near itinerary: **Add Destination**, **Optimize Trip**.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ My Trips > Japan 2027              Members ○ ○ ○  [+ Invite]       │
│ Main Trip | Destinations | Suggestions | Members | Settings         │
├────────────────────────────────┬────────────────────────────────────┤
│ DAY 1 — Shibuya / Harajuku     │ STICKY INTERACTIVE MAP             │
│ 09:00  Cafe                   │ Day 1  Day 2  Day 3 ...           │
│ 10:30  Shrine                 │                                    │
│ 12:00  Lunch                  │ ①──②──③  (selected day's route)    │
│ [+ Add] [Optimize Day]        │                                    │
│                                │                                    │
│ DAY 2 — Shinjuku              │                                    │
│ ...                            │                                    │
├────────────────────────────────┴────────────────────────────────────┤
│ [Open AI Assistant]  (drawer opens only when requested)             │
└─────────────────────────────────────────────────────────────────────┘
```

### Mobile
- **Map on top, itinerary below** in a stacked layout.
- Day chips/selectors allow quick switching.
- AI assistant opens as an overlay/sheet, not a permanently occupied column.
- Tablet can use split or stacked layout according to available width.

### Map + itinerary interaction
- Each day has a distinct visual route color.
- Selecting a day highlights that day's destinations and dims other days.
- Numbered map markers show visit order.
- Clicking a marker focuses the destination in the itinerary; selecting an itinerary item highlights its marker.
- As users scroll between day sections on desktop, the map follows the active day.
- Map is for geographic context and destination order, **not navigation directions**.
- Clearly distinguish ordered destination connections from verified walking paths; do not imply route accuracy that has not been calculated.

## 6. Daily Itinerary

Each day displays:
- Day number, date, optional neighborhood/city heading.
- Ordered destinations with planned time and estimated visit duration.
- Destination details on click: name, location/address, notes, estimated duration, optional fixed time, and actions.
- **Add Destination**, **Optimize Day**, manual reorder, edit time/duration, move day, remove.
- Trip-level **Optimize Entire Trip**.
- User may **lock** a reservation, activity, or fixed day/time; AI respects locks.
- Activities can be **fixed**, **preferred**, or **flexible** when relevant, without forcing complex setup.
- Leave unscheduled items visible elsewhere rather than silently dropping them.

## 7. Destination Collection & Input

All input methods feed the **same shared trip destination collection**:

1. **AI chat:** Paste a free-form list or describe places in natural language.
2. **Manual search:** Search and select a destination.
3. **Manual entry:** Add a destination directly if search is insufficient.
4. **Paste/import links:** Try to identify a place from a TikTok, Instagram, maps, or website link where permitted and technically accessible; ask for confirmation if ambiguous.

### Destinations tab
- Filters: **All**, **Scheduled**, **Unscheduled**.
- Each place shows its name and scheduled day/time if applicable.
- Unscheduled places support **Add to Day**, **Let AI Place**, or remain saved.
- A single place record should not be duplicated merely because it appears in both the collection and itinerary.

### Add Destination actions
- **Add Directly:** Commit to the shared itinerary immediately, choosing a day or requesting suggested placement.
- **Propose to Group:** Submit an optional proposal for review.
- **Save as Idea:** Store without scheduling.

Adding directly does **not** automatically reshuffle the whole trip. AI may flag a scheduling issue, but optimization runs only when requested.

## 8. Collaboration — Git-Inspired, Not Git-Restricted

### Membership
- Invite members through a **shareable trip link**.
- No friends list, follow graph, or preexisting connection required.
- Opening an invite shows the trip and a **Join Trip** action; authentication can occur before completing join.
- Default concept: link holders can join, with an owner able to disable/regenerate the link.
- Members and invitation control live in the trip workspace.

### Three contribution paths
| Action | Effect |
|---|---|
| Add Directly | Update shared itinerary now |
| Propose Change | Open a reviewable proposal without changing main itinerary |
| Save as Idea | Add to unscheduled collection |

Users choose their own workflow. Do not require a pull request for every change.

### Proposal experience
- Suggestions tab: **Open / Merged / Closed**.
- Proposal can add a place, move an activity, or suggest several related edits.
- Show author, description, affected day(s), comments, and status.
- Optional AI **impact analysis**: Does it fit? Does it create a conflict? Where might it go?
- Group members can discuss and accept/reject; an accepted proposal can be merged with a reviewed placement.
- If optimization cannot confidently place something, mark it **Needs Review** with a short, specific reason.
- Exact voting thresholds or role permissions are **not decided**; do not assume mandatory approvals.

### History and recovery
- Show who changed what and when.
- Support undoing changes and recovering earlier versions.
- Restoring a version should preview effects on subsequent collaborators' edits rather than silently overwriting them.
- AI-generated changes always have a preview/diff before application.

## 9. AI Trip Optimizer

### User inputs
- Trip dates / number of days and destinations.
- Existing manually scheduled activities and locked reservations.
- City/day allocations, including fixed or partially fixed cities.
- Optimization mode: **Relaxed / Balanced / Packed**.
- Optional natural-language constraints such as preferred start time, extra time at a location, or wanting a slower day.

### Primary job
1. Identify/resolve the destinations supplied by the user.
2. Group places primarily by **geographic proximity**.
3. Distribute geographic groups across available days, respecting fixed city dates.
4. Order stops to minimize unnecessary backtracking based on distance/convenience.
5. Assign plausible visit durations and daily times, considering known opening hours and locked activities.
6. Fit as many destinations as realistically possible within the selected mode.
7. Show any places that **could not fit** in a simple unscheduled list.
8. Preview proposed changes and apply only after user confirmation.

**Do not** optimize based on inferred personal taste to decide which user-supplied destinations deserve to be dropped. For overflow, prioritize geographic efficiency and feasibility; list leftovers plainly.

### Modes
| Mode | Goal | Approximate activities/day (illustrative only) |
|---|---|---|
| Relaxed | More free time and fewer stops | 2–4 |
| **Balanced (default)** | Comfortable efficiency | 4–6 |
| Packed | Fit more stops with tighter days | 6–8+ |

These are guidelines, not hard rules. Actual feasibility depends on distances, durations, hours, and fixed constraints.

### Optimization scope
- **Entire Trip:** Redistribute flexible destinations across days.
- **Specific Day:** Improve one day's ordering without altering others.
- **Selected Activities:** Optimize a user-selected subset.

### Preview and confirmation
- Before/after day itinerary, moved/added/removed items, and a concise explanation.
- **Apply Changes**, **Modify**, **Discard**.
- AI cannot silently modify the main itinerary or locked plans.
- When a direct edit makes a day crowded, offer an optional **Optimize Day** action rather than automatically changing it.

### What doesn't fit
- Simple outcome: “28 of 35 destinations scheduled; 7 couldn't fit.”
- Keep remaining destinations in **Unscheduled**.
- User can adjust manually or run optimization again.
- Do not build a complicated interest-priority scoring or exclusion explanation system for overflow.

### Transportation explicitly out of scope
- No walking-only / transit / driving preference selector.
- No transport bookings, transit schedules, turn-by-turn directions, or detailed point-to-point travel guidance.
- Map illustrates geographically convenient groupings/order, not guaranteed travel routes or arrival times.

## 10. AI Assistant — On-Demand Trip Copilot

- Accessible from the **main trip page** in a collapsible side panel (mobile overlay).
- Knows the active trip, destinations, days, locks, and conversation context.
- Can parse destination lists, suggest city/day allocations, optimize schedules, check fit, and find places when asked.
- Example prompts:
  - “Here are 20 Tokyo places; fit them into five days.”
  - “Optimize Day 2 without moving our dinner reservation.”
  - “Can this shop fit on Day 3?”
  - “Find more archival fashion stores like the ones I've saved.”
- AI outputs should distinguish **suggestions**, **verified facts**, and **uncertainties**.
- Chat proposals that change itinerary appear as previews; no silent edits.

## 11. Personalized Place Discovery — Requested Only

### Product behavior
- **No onboarding preference questionnaire.**
- Learn preferences gradually from user-provided destinations, chat language, saves, accepted/rejected suggestions, and other meaningful actions.
- Recommendations appear **only when the user asks** (e.g., via AI chat or **Find More Places**).
- No unsolicited feed, pop-up recommendations, automatic gap filling, or automatic additions.
- An empty period in a day can be shown as free time, with an optional **Find More Places** action; the app does not generate recommendations until selected.

### Personalization signals
- Stronger: places added, explicitly requested “more like this,” saved places, accepted recommendations.
- Weaker/ambiguous: views, skips, removals caused by time constraints.
- Learn specific **vibes**, not only categories: e.g., archival designer boutiques vs. generic shopping; chic independent specialty coffee vs. generic cafes.
- Distinguish **personal taste**, **current-trip context**, and **group choices**. A group member's additions should not automatically become everyone else's personal preferences.
- Carry useful taste patterns between trips while allowing preferences to evolve.
- Preserve recommendation diversity; avoid assuming one interest defines the user forever.
- Provide understandable “Why this?” reasoning and simple ways to correct unwanted suggestions.

### Retrieval and freshness
- Potential information sources: current place databases, recent reviews, permitted social content, user-submitted social links, and eventually user-contributed trip data.
- Favor recent, relevant evidence over generic or outdated travel blog lists.
- Verify place identity and available operating information where possible.
- A RAG-style retrieval layer **may** help find and explain candidates; retrieval alone does not constitute a personalized ranking system.
- Do not assume unrestricted access to TikTok/Instagram video content or recommendation algorithms; handle unavailable links gracefully.

### Recommendation output
- Place name, neighborhood/location, concise reason it fits the user's inferred taste, and optionally where it could fit in the trip.
- Actions: **Add Directly**, **Propose to Group**, **Save as Idea**, **Not Interested**.
- “More Like This” is a user-invoked way to find similar aesthetics, potentially across categories.
- Suggestions are not inserted into the itinerary unless the user chooses to do so.

## 12. Optional Gap Filling

- The optimizer schedules **only destinations already provided**.
- If a day has free time, show that free time without suggesting new stops automatically.
- **Find More Places** is an explicit action that requests personalized nearby suggestions.
- User decides whether to add, propose, or save any suggestion.

## 13. Key End-to-End Flows

### Flow A — Create and plan
1. User opens My Trips → Create Trip.
2. Enters trip name, destination, dates.
3. Lands in the empty trip workspace.
4. Pastes destination list into AI chat or adds places manually/imports links.
5. Chooses Relaxed, Balanced, or Packed (Balanced default).
6. Requests optimization → previews day allocations and ordered destinations.
7. Applies itinerary → views days alongside synchronized map.
8. Any unfit places remain in Unscheduled.

### Flow B — Invite and collaborate
1. Trip member selects Invite → copies link.
2. Friend opens link, signs in if necessary, joins trip.
3. Friend directly adds a confirmed destination, proposes an uncertain one, or saves an idea.
4. Proposed change can be discussed and optionally checked by AI.
5. Accepted change is merged; the group can request optimization and preview resulting adjustments.
6. History records changes; recovery is available.

### Flow C — Personalized discovery
1. User asks AI: “Find chic independent cafes near Day 2, like the ones I've saved.”
2. AI uses available preference and trip context to retrieve and rank candidates.
3. User reviews suggestions and their rationale.
4. User chooses Add Directly, Propose, Save as Idea, or Not Interested.
5. Only selected destinations enter the shared collection or itinerary.

### Flow D — Multi-city trip
1. User adds Tokyo, Kyoto, Osaka to a 14-day trip.
2. Optionally sets fixed dates for one or more cities.
3. Asks AI to allocate remaining days or manually assigns them.
4. Reviews proposed allocation, applies if desired.
5. Optimizer groups destinations within city/day constraints.

## 14. Interaction States & Edge Cases

- **Empty trip:** Show clear actions to paste destinations, add manually, invite, or open AI.
- **Ambiguous pasted place:** Ask user to confirm which location before scheduling.
- **Unavailable social link:** Let user enter the place name manually; do not claim extraction succeeded.
- **Place closed or hours unknown:** Flag uncertainty; avoid confident scheduling claims.
- **Conflicting locked activities:** Show conflict; do not override locks.
- **Too many destinations:** Fit what is feasible and list the rest simply.
- **Simultaneous edits:** Show latest shared state and preserve change history; avoid silently overwriting collaborators.
- **Optimization preview becomes outdated after another edit:** Require refresh/review before applying.
- **Invitation revoked:** Old links stop granting access.
- **New user with no history:** Discovery still works when requested, using the current query/trip; preferences improve with use.
- **Mobile:** Map, itinerary, and AI remain accessible without overcrowding the screen.

## 15. Initial Feature Scope

### Core V1
- Account access sufficient to create/join trips.
- Trips dashboard; minimal trip creation; multiple cities.
- Invite/join by link; shared trip membership.
- Main itinerary workspace with responsive map/day synchronization.
- Destination collection with scheduled/unscheduled states.
- AI chat and manual/list/link destination input (subject to supported sources).
- AI geographic grouping and daily scheduling with three pacing modes.
- Locked plans and preview/apply optimization.
- Direct edits, proposals, basic comments/review, history/recovery.
- On-demand personalized destination suggestions from interaction history and trip context.
- Clear overflow/uncertainty handling.

### Explicitly deferred / out of scope
- Friend lists, followers, public social feeds, and influencer-style profiles.
- Expense splitting and payments.
- Travel reservations or ticket purchasing.
- Detailed transit, driving, walking directions, or transport-mode optimization.
- Unsolicited AI suggestions or automatic gap filling.
- Mandatory onboarding taste quizzes.
- Complex ranking of *user-provided* destinations by inferred preference when scheduling overflow.
- Specific implementation architecture, data stores, model providers, and scaling choices (to be designed later).

## 16. Open Product Details (Not Yet Decided)

These are implementation/product refinements, **not previously agreed requirements**:
- Whether every member can regenerate invite links or only the trip owner.
- Exact proposal approval mechanism (single reviewer, vote, or informal accept) and member permissions.
- Whether optimization previews support selective application of individual changes.
- How long history is retained and how conflict recovery is presented.
- Which external link imports can be supported reliably and legally.
- How user personalization history is controlled, reset, or deleted.
- Exact trip creation support for destinations spanning multiple countries/time zones.
- Precise small-screen navigation and accessibility specifications.

---

**One-sentence product definition:** A flexible, shared trip workspace where travelers add destinations however they like, let AI organize them into geographically convenient days, collaborate through direct edits or optional proposals, and request recommendations that improve naturally with their own travel behavior.
