# Monster Agent Hub UI Direction

## Subject and job

The subject is a personal AI-agent switchboard for Paul on a 1600 x 2240 Android tablet. Its single job is to turn one plain-language objective into a visible, controllable plan and make it easy to choose, compare, approve, stop, or redirect the agents doing the work.

It is not a miniature desktop IDE and not an analytics dashboard. The interface should remain legible at arm's length and make risky authority, uncertain routing, and spending harder to overlook than routine status.

## Visual system

The design borrows from a modular studio rack and a dispatch board: labeled modules, clear signal states, physical-feeling controls, and a visible route from input to output.

### Color tokens

| Token           |       Hex | Role                                         |
| --------------- | --------: | -------------------------------------------- |
| Deep ink        | `#0B1420` | Main canvas and high-contrast text surface   |
| Instrument navy | `#172A3A` | Raised modules and navigation                |
| Ceramic         | `#F2EEDB` | Primary text and quiet light surfaces        |
| Signal blue     | `#6CB7E8` | Selected routes, active work, keyboard focus |
| Relay amber     | `#F2B84B` | Pending approval, cost, and human attention  |
| Fault coral     | `#F06C67` | Stop, unsafe, failed, or blocked state       |

Color is never the only status cue. Every state also has text and a shape/icon treatment.

### Type

- Display and controls: **Archivo Variable**, with compact widths and deliberate weight shifts.
- Data, versions, cost, and event times: **IBM Plex Mono Variable**.
- Fallbacks are bundled/system sans and monospace; the installed PWA never depends on a live font CDN.

### Layout

Portrait is primary, landscape is denser, and split-screen collapses to one column.

```text
+------------------------------------------------+
| MONSTER AGENT HUB        host + tablet health |
+------------------------------------------------+
| What should the crew accomplish?               |
| [ natural-language objective              ]    |
| constraints / workspace / budget  [Plan work] |
+------------------------------------------------+
| DELEGATION RAIL                               > |
| intent == research ==> implement ==> verify    |
|            agent/model/cost/confidence          |
+----------------------+-------------------------+
| AGENT RACK           | APPROVALS / LIVE WORK   |
| cards + filters      | next decision first     |
+----------------------+-------------------------+
| evidence / recent outcomes / stop all           |
+------------------------------------------------+
```

## Signature element: the delegation rail

The rail is the one deliberate visual risk. It treats the plan as a signal path: one objective enters at the left/top, splits only where tasks can run concurrently, and rejoins for verification and synthesis. Each segment contains the assigned agent/model/tool profile, selection reason, confidence, reserved cost, and current state. A branch that needs human approval visibly interrupts the line with an amber gate.

Motion is limited to one route-draw sequence when a plan becomes ready and subtle progress movement while a task is actually running. Reduced-motion users receive an immediate static state. There are no ambient particle effects or constantly pulsing cards.

## Agent modules

Every agent module shows, without opening a details dialog:

- Ready, degraded, offline, or unsupported state.
- Runtime location and current version.
- Two strongest **Best for** entries.
- The first **Do not use for** warning.
- Measured category evidence separately from declared capability.
- The exact action available: Open, assign, reconnect, install, or view limitation.

Longer guidance, tool authority, supported handoffs, benchmark history, and launch modes live in an accessible details sheet.

## Interaction rules

- Primary touch targets are at least 48 CSS pixels; destructive/approval actions receive extra separation.
- `Plan work` never starts work. It produces a reviewable plan.
- `Approve and run` states the reserved budget and consequential permissions in the button's surrounding text.
- `Stop` remains visible during every active run and cancels owned descendants.
- Offline mode keeps the catalog, help, and previous evidence readable but disables launches and approvals.
- Focus order follows the visual flow; focus rings use signal blue with a ceramic offset.
- Errors state what failed, what remained unchanged, and the next safe action.

## Self-critique and revision

The first concept leaned toward a familiar black-and-neon “AI command center.” That would be interchangeable with many generated dashboards and would compete with the information. The revised studio-rack direction keeps a dark operational canvas but replaces decorative glow with labeled physical modules and a route diagram that directly represents delegation. The delegation rail gets the visual drama; cards, navigation, and surfaces remain disciplined.
