# Webtoon Pattern Definitions

## Purpose

This document defines the layout and pacing patterns used by the webtoon mode.
It keeps current patterns, proposes new ones inspired by Korean vertical-scroll
webtoon grammar, and separates geometry from pacing/camera effects so the system
does not overuse a single layout such as `hero_drop`.

## Pattern Model

The webtoon layout system should use three layers:

1. `core_pattern`
   Defines the main page geometry and reading rhythm.
2. `pacing_modifier`
   Defines spacing, pause, reveal, and beat compression.
3. `camera_modifier`
   Defines cinematic movement cues such as zoom, drift, tilt, and dissolve.

Static anchor templates remain available for highly controlled beats, but the
default should be dynamic page composition.

## Current Core Patterns

### `stack_focus`

- Intent: safe default mobile rhythm with one broader beat and narrower support beats.
- Best for: exposition, dialogue, educational explanation, calm scene progression.
- Geometry rules:
  - one medium-to-wide focus panel
  - one or more portrait-leaning support panels
  - avoid three equal full-width strips in a row
- Risk: can feel generic if repeated too often.

### `hero_drop`

- Intent: open with a dominant hero beat, then drop into narrower follow-up beats.
- Best for: introductions, location entry, strong scene opening, character reveal.
- Geometry rules:
  - top beat spans nearly full width
  - lower beats become narrower and more portrait-leaning
  - focus usually stays on panel 1
- Risk: if used too often, all pages start to feel the same.

### `split_row`

- Intent: break the vertical stack with one compact left-right row.
- Best for: comparison, counterplay, action exchange, two-person interaction.
- Geometry rules:
  - keep overall top-to-bottom reading order
  - include one compact split row only
  - use surrounding vertical beats to preserve mobile readability
- Risk: weak on highly emotional scenes unless paired with close-up support.

### `stair_step`

- Intent: create a left-right offset staircase flow.
- Best for: movement, chase, travel, transition, shifting point of view.
- Geometry rules:
  - panels step left/right as they descend
  - widths vary moderately
  - transition beats can be compact and inset
- Risk: can feel restless if overused on quiet scenes.

### `closeup_pulse`

- Intent: alternate broader beats with narrow close-up pulses.
- Best for: romance, drama, emotional hesitation, reaction-heavy dialogue.
- Geometry rules:
  - medium-wide beat followed by narrower centered close-up
  - portrait panels carry expression and silence
  - spacing should feel tighter than `hero_drop`
- Risk: weak for large-scale action unless mixed with a stronger opener.

### `impact_tail`

- Intent: build tension with smaller setup beats, then land on a large climax beat.
- Best for: cliffhanger, final reveal, dramatic decision, finishing beat.
- Geometry rules:
  - early beats remain compact
  - whitespace increases before the final beat
  - last beat can expand to full width
- Risk: should be used sparingly or endings lose impact.

## Expanded Core Patterns

### `vertical_panorama`

- Status: implemented
- Intent: use vertical depth as the main attraction.
- Best for: city scale, towers, stairs, falling, giant objects, crowd depth, entry into a large place.
- Geometry rules:
  - one tall environment-led panel anchors the page
  - support beats are narrow inserts or short transition beats
  - vertical continuity matters more than width variety
- Distinction from current patterns:
  - not just a big opener
  - the key is sustained vertical depth, not a top hero image

### `void_reveal`

- Status: implemented
- Intent: make blank space itself part of the reveal timing.
- Best for: horror, suspense, delayed punchline, emotional pause, hidden payoff.
- Geometry rules:
  - compact setup beat
  - long empty gap or near-empty transition field
  - reveal beat appears after a scroll delay
- Distinction from current patterns:
  - current `long_pause_gap` is only a modifier
  - this pattern makes the pause the primary structure

### `continuity_chain`

- Status: implemented
- Intent: split one event into multiple micro-beats so the reader feels time passing while scrolling.
- Best for: action continuation, suspense approach, object handling, slow realization, escalating reaction.
- Geometry rules:
  - 3 to 5 connected beats of the same event
  - modest width changes, stronger temporal continuity
  - no single beat should dominate too early
- Distinction from current patterns:
  - current patterns mostly vary composition
  - this one emphasizes event segmentation and time slicing

### `motion_runway`

- Status: implemented
- Intent: align movement energy with scroll direction.
- Best for: rush, attack, sprint, jump, fall, collision setup.
- Geometry rules:
  - beats lean into downward or diagonal-forward motion
  - panel offsets should support directional force
  - optional angled geometry is useful but not required
- Distinction from current patterns:
  - `stair_step` offsets for rhythm
  - `motion_runway` offsets for directional acceleration

### `one_point_charge`

- Status: implemented
- Intent: pull the eye into a single vanishing-point attack or corridor composition.
- Best for: duel faceoff, tunnel entry, hallway tension, target lock, charge scenes.
- Geometry rules:
  - one dominant perspective-driven beat
  - support beats reinforce approach or distance collapse
  - horizon and center pull matter more than panel count
- Distinction from current patterns:
  - `impact_tail` saves a large payoff for the end
  - `one_point_charge` uses perspective pull as the core visual device

## Static Anchor Templates

Static anchors should remain limited to a small number of pages per episode.

### Keep

- `webtoon_hero_stack`
- `webtoon_stack_3`
- `webtoon_stack_4`
- `webtoon_impact`

### Proposed Future Anchors

- `webtoon_void_reveal_anchor`
  - for horror or delayed reveal pages
- `webtoon_vertical_panorama_anchor`
  - for architecture, falling, and scale pages

## Modifier Expansion

Current modifiers are useful, but they mix different responsibilities. They
should be grouped into clearer buckets.

### Pacing Modifiers

- `long_pause_gap`
- `micro_reaction`
- `breath_hold`
  - new candidate
  - compresses setup beats before a reveal

### Camera Modifiers

- `inset_closeup`
- `diagonal_cut`
- `zoom_chain`
  - new candidate
  - makes consecutive beats feel like progressive zoom-in
- `focus_pull`
  - new candidate
  - shifts emphasis from foreground to background or vice versa
- `dissolve_transition`
  - new candidate
  - gives a softer temporal bridge between beats

### Surface / Framing Modifiers

- `borderless_open`
- `overlap_bleed`

## Selection Rules To Reduce `hero_drop` Bias

### Rule 1: Stop using `hero_drop` as the soft fallback

If no strong signal exists:

- use `stack_focus` for neutral pages
- use `closeup_pulse` for dialogue-heavy pages
- use `stair_step` for transition-heavy pages

### Rule 2: Narrow the role of `hero_drop`

Prefer `hero_drop` only when at least one is true:

- page starts with an establishing beat
- first beat is the visual focus
- introduction or entrance is the main purpose of the page

### Rule 3: Add repetition penalty

When the last 2 pages used the same `core_pattern`, lower its score unless the
page role explicitly demands repetition.

### Rule 4: Let scene intent override panel count

Do not choose a pattern mainly because the page has 3 panels or 4 panels.
Choose it from beat intent:

- scale -> `vertical_panorama`
- reveal delay -> `void_reveal`
- continuous event -> `continuity_chain`
- motion drive -> `motion_runway`
- emotional pulse -> `closeup_pulse`
- intro beat -> `hero_drop`

## Intent Tags

The selector should reason in terms of page intent first, not panel count first.

### Intent tag set

- `intro_entry`
  - a page that introduces a place, character, or scene direction
- `scale_space`
  - a page where spatial depth or vertical size matters
- `dialogue_exchange`
  - a page carried by conversation or back-and-forth reaction
- `emotional_focus`
  - a page where expression, hesitation, or feeling is the key beat
- `movement_transition`
  - a page about travel, chase, shift, approach, or scene movement
- `continuous_action`
  - a page that slices one event into multiple action beats
- `reveal_delay`
  - a page that depends on pause, suspense, or delayed payoff
- `climax_payoff`
  - a page whose main job is landing a strong ending beat

### Intent signal extraction

The selector should infer intent scores from page-local and outline-local data.

Primary inputs already available in the current system:

- `page_outlines[n].narrative_function`
- `PageSpec.layout.scroll.segment_role`
- `webtoon_layout.panels[].scene_type`
- `webtoon_layout.panel_count`
- `webtoon_layout.focus_panel_index`
- `webtoon_layout.modifiers`
- `webtoon_layout.gap_profile`

Recommended signal rules:

- `intro_entry`
  - `+3` if `narrative_function === "introduction"`
  - `+2` if `segment_role === "intro"`
  - `+2` if first scene type is `establishing`
- `scale_space`
  - `+3` if first scene type is `establishing`
  - `+1` if page starts with a focus panel at index 1
  - `+1` if panel count is `2` or `3` and one panel has high height weight
- `dialogue_exchange`
  - `+2` per `dialogue` scene, capped at `+4`
  - `+1` if no `impact` scene exists
- `emotional_focus`
  - `+2` per `emotional` scene, capped at `+4`
  - `+2` per `closeup` scene, capped at `+4`
- `movement_transition`
  - `+3` if any scene type is `transition`
  - `+1` if action and transition both appear on the same page
- `continuous_action`
  - `+2` per `action` scene, capped at `+4`
  - `+2` if panel count is `4` or `5`
- `reveal_delay`
  - `+2` if `gap_profile === "dramatic"`
  - `+2` if modifiers include `long_pause_gap`
  - `+1` if last panel is the focus panel
- `climax_payoff`
  - `+3` if `narrative_function === "climax"`
  - `+2` if `segment_role === "climax"`
  - `+2` if any scene type is `impact`
  - `+1` if focus panel is the last panel

Normalize each intent score into a `0..5` range after accumulation.

## Phase 1 Scoring Matrix

Phase 1 should work with the six current patterns only. Scores below are affinity
weights in the `0..5` range.

| Pattern | intro_entry | scale_space | dialogue_exchange | emotional_focus | movement_transition | continuous_action | reveal_delay | climax_payoff |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `stack_focus` | 3 | 2 | 4 | 3 | 2 | 2 | 2 | 2 |
| `hero_drop` | 5 | 4 | 1 | 2 | 1 | 2 | 1 | 2 |
| `split_row` | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 |
| `stair_step` | 2 | 2 | 1 | 1 | 5 | 3 | 2 | 2 |
| `closeup_pulse` | 1 | 1 | 4 | 5 | 1 | 1 | 3 | 2 |
| `impact_tail` | 1 | 1 | 1 | 2 | 1 | 3 | 4 | 5 |

### Interpretation

- `hero_drop` wins only when intro or scale signals are genuinely strong.
- `stack_focus` is the neutral generalist, not the hidden fallback hack.
- `closeup_pulse` should dominate feeling-heavy pages.
- `stair_step` should dominate movement-heavy pages.
- `impact_tail` should dominate climax and delayed-payoff pages.

## Phase 2 Expansion Matrix

When new patterns land, add them to the same scoring system.

| Pattern | intro_entry | scale_space | dialogue_exchange | emotional_focus | movement_transition | continuous_action | reveal_delay | climax_payoff |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `vertical_panorama` | 3 | 5 | 0 | 1 | 2 | 1 | 1 | 2 |
| `void_reveal` | 1 | 1 | 1 | 3 | 1 | 0 | 5 | 4 |
| `continuity_chain` | 1 | 1 | 2 | 2 | 3 | 5 | 2 | 3 |
| `motion_runway` | 1 | 2 | 0 | 0 | 4 | 5 | 1 | 3 |
| `one_point_charge` | 2 | 2 | 0 | 1 | 3 | 4 | 2 | 4 |

## Scoring Formula

The selector should use a weighted sum where intent fit clearly outweighs
diversity shaping.

### Base fit

```text
base_fit(pattern) =
  sum(intent_score[intent] * affinity[pattern][intent]) / 5
```

This usually yields a base score in the `0..20` range.

### Diversity shaping

Use both a repetition penalty and a small positive spread bonus.

```text
history_adjustment(pattern) =
  repetition_penalty(pattern) + spread_bonus(pattern)
```

Recommended values:

- repetition penalty
  - `-1.0` if pattern equals previous page
  - `-0.6` if pattern equals page -2
  - extra `-1.2` if pattern equals both previous pages
- spread bonus
  - `+0.6` if pattern is not present in the last 2 pages
  - `+0.4` if choosing it increases the unique pattern count in the 3-page window
  - cap total spread bonus at `+1.0`

### Guardrail

History adjustment must never dominate story intent.

- cap total history adjustment to the `-2.8 .. +1.0` range
- never replace a pattern whose base fit beats the runner-up by `>= 2.0`

### Final score

```text
final_score(pattern) = base_fit(pattern) + history_adjustment(pattern)
```

## Hard Gates And Tie Breakers

### Hard gates

- `split_row`
  - require `panel_count >= 3`
- `impact_tail`
  - strongly discourage if there is no `impact` scene and no last-panel focus
- `closeup_pulse`
  - discourage if there are no `dialogue`, `emotional`, or `closeup` scenes
- `hero_drop`
  - discourage unless at least one of these is true:
    - first scene is `establishing`
    - focus panel is panel `1`
    - `narrative_function === "introduction"`
- `stair_step`
  - encourage when at least one `transition` scene exists

### Tie breaker rules

When two candidates are close:

- if score gap is `< 0.75`, choose the one with higher base fit
- if base fit is also tied, choose the less recently used pattern
- if still tied, choose the simpler geometry for readability:
  - `stack_focus` over `stair_step`
  - `stair_step` over `split_row`
  - `closeup_pulse` over `hero_drop` on emotional pages

## Implementation Draft

The cleanest implementation is to separate scoring from geometry generation.

### New internal service

Create a new internal scoring module:

- `services/webtoonPatternScoring.ts`

Recommended types:

```ts
type WebtoonIntentTag =
  | "intro_entry"
  | "scale_space"
  | "dialogue_exchange"
  | "emotional_focus"
  | "movement_transition"
  | "continuous_action"
  | "reveal_delay"
  | "climax_payoff";

type IntentScoreMap = Record<WebtoonIntentTag, number>;

type PatternScoreBreakdown = {
  pattern: string;
  baseFit: number;
  historyAdjustment: number;
  finalScore: number;
  reasons: string[];
};
```

Recommended functions:

```ts
function inferIntentScores(ctx: {
  narrativeFunction?: string;
  segmentRole?: string;
  panelCount: number;
  focusPanelIndex: number;
  sceneTypes: string[];
  modifiers: string[];
  gapProfile?: string;
}): IntentScoreMap;

function scorePatternCandidate(ctx: {
  pattern: string;
  intents: IntentScoreMap;
  previousPatterns: string[];
  panelCount: number;
  sceneTypes: string[];
  focusPanelIndex: number;
  narrativeFunction?: string;
}): PatternScoreBreakdown;

function chooseBestPattern(ctx: {
  availablePatterns: string[];
  previousPatterns: string[];
  narrativeFunction?: string;
  segmentRole?: string;
  panelCount: number;
  focusPanelIndex: number;
  sceneTypes: string[];
  modifiers: string[];
  gapProfile?: string;
}): {
  chosen: string;
  breakdowns: PatternScoreBreakdown[];
};
```

### Integration points

#### `services/planner.ts`

After `parseDynamicLayout(p.webtoon_layout)` succeeds, score the candidate
patterns using:

- outline `narrative_function`
- computed `scroll.segment_role`
- parsed `scene_type` list
- parsed `panel_count`
- recent dynamic page pattern history

Then:

- if `core_pattern` is missing, set it from `chooseBestPattern`
- if `core_pattern` is present, compare it against the best-scored candidate
- keep the model choice when it is close enough
- override only when it is clearly weaker or creates unhealthy repetition

Recommended override policy:

- keep model choice if its final score is within `1.5` of the best candidate
- override if it trails by `> 1.5`
- override if it would create 3 repeated pages and a non-repeating candidate is within `1.0`

#### `services/webtoonLayoutBuilder.ts`

Keep this module focused on geometry only.

- do not let it become the home for page-history rules
- `resolveSingleBeatRect` should remain pattern-specific geometry
- `inferCorePattern` can stay as a last-resort fallback for incomplete data, but
  it should no longer be the main selector

### Debug output

Store selection reasoning in planner debug output so tuning is possible.

Recommended debug payload per page:

```ts
{
  page_index: 3,
  intents: {
    intro_entry: 1,
    emotional_focus: 4,
    climax_payoff: 0
  },
  candidate_scores: [
    { pattern: "closeup_pulse", baseFit: 8.4, historyAdjustment: 0.6, finalScore: 9.0 },
    { pattern: "hero_drop", baseFit: 4.0, historyAdjustment: -1.0, finalScore: 3.0 }
  ],
  chosen_pattern: "closeup_pulse"
}
```

## Practical Selection Examples

### Example A: introduction page with environment opener

- narrative function: `introduction`
- scene types: `establishing`, `dialogue`, `dialogue`
- likely winner: `hero_drop`
- reason:
  - intro and scale intent are both high
  - emotional and action intent are low

### Example B: romance hesitation page

- narrative function: `deepening`
- scene types: `dialogue`, `closeup`, `emotional`, `closeup`
- likely winner: `closeup_pulse`
- reason:
  - emotional focus dominates
  - `hero_drop` should lose even if it has not appeared recently

### Example C: chase transition page after two `hero_drop` pages

- narrative function: `turning_point`
- scene types: `transition`, `action`, `transition`, `action`
- recent history: `hero_drop`, `hero_drop`
- likely winner: `stair_step` or `split_row`
- reason:
  - movement/action fit is already stronger
  - repetition shaping pushes away from a third `hero_drop`

### Example D: suspense setup then last-panel reveal

- narrative function: `climax`
- scene types: `dialogue`, `transition`, `impact`
- gap profile: `dramatic`
- modifier: `long_pause_gap`
- likely winner: `impact_tail`
- future expanded winner candidate: `void_reveal`

## Implementation Status

### Completed

- keep current six `core_pattern` values
- rebalance selection so `stack_focus` becomes the neutral default
- add repetition penalty
- add `vertical_panorama`
- add `void_reveal`
- add `continuity_chain`
- add `motion_runway`
- add `one_point_charge`

### Still Future

- add camera-specific modifier scoring
- add static anchors such as `webtoon_void_reveal_anchor`

## Reference Notes

The proposed additions are based on recurring vertical-scroll webtoon grammar
observed in Korean webtoon studies, creator discourse, and webtoon form
analysis:

- action-oriented vertical scroll direction and panel motion alignment
- expanded vertical space for scale and movement
- whitespace as time and suspense
- cinematic remediations such as pan, tilt, zoom, and dissolve
