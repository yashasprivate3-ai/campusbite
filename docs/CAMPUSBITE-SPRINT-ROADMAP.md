# CampusBite Sprint Roadmap

## Purpose

This roadmap takes CampusBite from its current browser-based prototype through a pilot-ready campus canteen ordering and kitchen-operations product. It is a planning document, not a claim that later-sprint security, payment, tax, or operational controls already exist.

## Status overview

| Sprint | Focus | Status |
| --- | --- | --- |
| 1 | Project foundation | Completed |
| 2 | Student ordering prototype | Completed |
| 3.1 | Kitchen order lifecycle | Completed |
| 3.2 | Batch engine foundation | Completed |
| 3.3 | Production batch summary | Completed |
| 3.4 | Kitchen batch workflow | Completed |
| 3.5 | Kitchen UI polish | Completed |
| 4 | Kitchen intelligence | Planned |
| 5 | Student order tracking | Planned |
| 6 | Backend and persistent data | Planned |
| 7 | Authentication and roles | Planned |
| 8 | UPI payments | Planned |
| 9 | Inventory and availability | Planned |
| 10 | Analytics and operational readiness | Planned |

---

## Sprint 1 — Project Foundation

**Objective:** Establish a dependable local development baseline for CampusBite.

**Features**

- React application created with Vite.
- Git repository and ignore rules.
- Basic `src`, `public`, and build structure.
- Local development, lint, build, and preview commands.

**Deliverables**

- Runnable React/Vite application.
- Version-controlled project foundation.
- README with local setup instructions.

**Dependencies:** Node.js, npm, Git, and a supported browser.

**Acceptance criteria**

- A new contributor can install dependencies and start the app locally.
- The production bundle builds without source errors.
- Generated files and dependencies are excluded from Git.

**Risks:** Inconsistent Node versions, missing setup documentation, or committing generated dependencies.

**Completion status:** Completed.

**Recommended Git milestone:** `Sprint 1: establish CampusBite React and Vite foundation`

---

## Sprint 2 — Student Ordering Prototype

**Objective:** Validate the complete student ordering experience without a production payment or backend dependency.

**Features**

- Landing page and canteen service status.
- Menu categories and item cards.
- Cart quantities, totals, and clearing.
- Checkout review.
- ASAP and scheduled pickup choices.
- Optional preparation instructions.
- Order token generation and confirmation.

**Deliverables**

- Responsive student menu and cart.
- Test checkout and confirmation experience.
- Structured confirmed-order data suitable for kitchen intake.

**Dependencies:** Sprint 1 foundation and representative menu data.

**Acceptance criteria**

- A student can add, remove, and review items.
- Pickup method, slot, and instructions survive through confirmation.
- Confirmation produces a unique visible token.
- No payment is implied or charged by the prototype.

**Risks:** Prototype totals being mistaken for verified payment, inaccessible controls, or stale menu availability.

**Completion status:** Completed.

**Recommended Git milestone:** `Sprint 2: deliver student ordering and checkout prototype`

---

## Sprint 3 — Kitchen Operations Foundation

Sprint 3 is divided into five incremental kitchen milestones so order lifecycle, batching, workflow, and layout can be verified independently.

### Sprint 3.1 — Kitchen Order Lifecycle

**Objective:** Give kitchen staff a clear order queue and dependable status movement.

**Features:** Kitchen dashboard, NEW → PREPARING → READY columns, and individual order controls.

**Deliverables:** Kitchen view switch, order tickets, status actions, and status-history entries.

**Dependencies:** Confirmed-order structure from Sprint 2.

**Acceptance criteria**

- Confirmed student orders appear in NEW.
- Individual actions move an order through valid statuses.
- Token, quantities, pickup data, instructions, and source remain traceable.

**Risks:** Accidental repeated transitions, lost order metadata, or kitchen price exposure.

**Completion status:** Completed.

**Recommended Git milestone:** `Sprint 3.1: add kitchen order lifecycle`

### Sprint 3.2 — Batch Engine Foundation

**Objective:** Aggregate compatible production demand while retaining links to originating orders.

**Features:** Batch data model, item quantity aggregation, and linked-order token traceability.

**Deliverables:** Batch calculator and grouped production records.

**Dependencies:** Kitchen orders with stable item identifiers, quantities, and tokens.

**Acceptance criteria**

- Required quantity equals the sum of grouped order quantities.
- Linked-order tokens are retained without losing source orders.
- Recalculation responds immediately to order-state changes.

**Risks:** Double counting, grouping incompatible pickup windows, or breaking links between batches and orders.

**Completion status:** Completed.

**Recommended Git milestone:** `Sprint 3.2: establish batch calculation and traceability`

### Sprint 3.3 — Production Batch Summary

**Objective:** Present aggregated cooking requirements in a fast, readable kitchen surface.

**Features:** Grouped production requirements, required quantities, and linked-order counts.

**Deliverables:** Production Batch Summary cards connected to live kitchen orders.

**Dependencies:** Sprint 3.2 calculator.

**Acceptance criteria**

- Each batch card identifies the item and required quantity.
- Linked-order count matches the associated order tokens.
- Kitchen cards do not display student prices.

**Risks:** Stale derived data or insufficient card space during peak demand.

**Completion status:** Completed.

**Recommended Git milestone:** `Sprint 3.3: add production batch summary`

### Sprint 3.4 — Kitchen Batch Workflow

**Objective:** Let the kitchen progress a group of linked orders safely as one production batch.

**Features:** Start Batch Preparation, Order In Progress, Complete Batch, Completed state, and linked-order status movement.

**Deliverables:** Guarded batch start/completion handlers and clear batch actions.

**Dependencies:** Sprints 3.1–3.3.

**Acceptance criteria**

- A NEW batch exposes one start action.
- Starting immediately removes repeated-start access and moves only linked NEW orders to PREPARING.
- Completing moves only linked PREPARING orders to READY.
- The batch displays Completed after completion.
- Status history preserves transition time and batch item traceability.

**Risks:** Duplicate handlers overriding guarded logic, partial batch completion, or unrelated orders changing status.

**Completion status:** Completed.

**Recommended Git milestone:** `Sprint 3.4: complete guarded kitchen batch workflow`

### Sprint 3.5 — Kitchen UI Polish

**Objective:** Make the batch workflow safe and readable across kitchen desktop, laptop, tablet, and mobile devices.

**Features:** Responsive wrapping grid, equal-height batch cards, contained actions, safe text wrapping, status styling, and no horizontal overflow.

**Deliverables:** Corrected Production Batch Summary CSS and regression documentation.

**Dependencies:** Final Sprint 3.4 JSX class names and actions.

**Acceptance criteria**

- Cards wrap instead of extending in a single horizontal row.
- Quantity, item, link count, and actions remain inside every card.
- In-progress controls never overlap adjacent cards.
- Mobile uses a single batch-card column.
- The complete student-to-kitchen lifecycle still passes.

**Risks:** CSS selectors drifting from component class names or unusually long item names expanding cards.

**Completion status:** Completed.

**Recommended Git milestone:** `Sprint 3.5: fix kitchen batch layout and add roadmap`

---

## Sprint 4 — Kitchen Intelligence

**Objective:** Help staff understand pace, workload, and production priority during service.

**Features**

- Batch timer and elapsed preparation time.
- Live kitchen counters.
- Searchable batch history.
- Explainable priority suggestions based on pickup promise and age.

**Deliverables:** Timer-aware batch model, operational summary counters, history view, and documented priority rules.

**Dependencies:** Reliable timestamps and status history from Sprint 3; a clear policy for scheduled versus ASAP priority.

**Acceptance criteria**

- Active batches show elapsed time without resetting after rerender.
- Counters reconcile with visible orders and batches.
- Completed batches are retrievable in history.
- Priority suggestions show their reason and never silently change order data.

**Risks:** Misleading timers after device sleep, priority starvation, and excessive interface noise.

**Completion status:** Planned.

**Recommended Git milestone:** `Sprint 4: add kitchen timing counters and batch intelligence`

---

## Sprint 5 — Student Order Tracking

**Objective:** Give students a clear post-order view from confirmation to pickup.

**Features:** Order Received, Preparing, Ready, pickup instructions, and live or near-live updates.

**Deliverables:** Token-based tracking screen, status timeline, refresh strategy, and pickup guidance.

**Dependencies:** Stable kitchen lifecycle; backend transport may begin as polling and later move to push updates.

**Acceptance criteria**

- A student can reopen a valid order using its token or authenticated account.
- Kitchen transitions appear accurately and in order.
- Ready messaging includes the correct pickup instructions.
- Stale/offline states are explicit.

**Risks:** Exposing another student's order, stale polling, and ambiguous pickup notifications.

**Completion status:** Planned.

**Recommended Git milestone:** `Sprint 5: deliver student order tracking`

---

## Sprint 6 — Backend and Persistent Data

**Objective:** Replace single-browser storage with a shared, durable source of truth.

**Features:** API layer, database, persistent orders/menu/batches/status history, and safe migration from local-only storage.

**Deliverables:** Versioned API, database schema and migrations, server validation, seed data, and migration/rollback plan.

**Dependencies:** Agreed data model from Sprints 2–5 and hosting choice.

**Acceptance criteria**

- Student and kitchen devices see the same order state.
- Writes are validated and idempotent where repetition is possible.
- Status history is append-only and auditable.
- Local data migration cannot duplicate orders.
- Backup and restore are tested.

**Risks:** Data loss, race conditions, duplicate confirmations, offline conflicts, and schema drift.

**Completion status:** Planned.

**Recommended Git milestone:** `Sprint 6: add shared API and persistent CampusBite data`

---

## Sprint 7 — Authentication and Roles

**Objective:** Protect student, kitchen, and administrative capabilities with appropriate identity and authorization.

**Features:** Student authentication, protected kitchen/admin routes, phone OTP or Google login, and role-based access.

**Deliverables:** Identity-provider integration, session management, authorization middleware, role matrix, and access audit tests.

**Dependencies:** Sprint 6 backend and institution identity/privacy decisions.

**Acceptance criteria**

- Unauthenticated users cannot access protected kitchen or admin operations.
- Server-side authorization is enforced independently of the UI.
- Session expiry and sign-out work reliably.
- Authentication errors do not expose sensitive account information.

**Risks:** OTP abuse, account takeover, incorrect role assignment, and privacy noncompliance.

**Completion status:** Planned.

**Recommended Git milestone:** `Sprint 7: secure CampusBite with authentication and roles`

---

## Sprint 8 — UPI Payments

**Objective:** Add verified payment collection without treating client-side confirmation as proof of payment.

**Features:** Payment gateway, server-side verification, receipts, failed-payment recovery, and refund handling.

**Deliverables:** Gateway integration, webhook verification, payment/order reconciliation, receipt record, refund process, and support runbook.

**Dependencies:** Backend, authentication, merchant account, legal terms, and operating policies.

**Acceptance criteria**

- Orders are marked paid only after trusted server verification.
- Duplicate callbacks do not create duplicate charges or orders.
- Failure, timeout, cancellation, and refund paths are testable.
- Payment records reconcile with gateway records.
- The current no-GST operating context is documented as a business constraint and is not hard-coded as tax advice; qualified local advice governs production invoicing.

**Risks:** Payment fraud, webhook spoofing, reconciliation gaps, refund disputes, and regulatory mistakes.

**Completion status:** Planned.

**Recommended Git milestone:** `Sprint 8: add verified UPI payments and receipts`

---

## Sprint 9 — Inventory and Availability

**Objective:** Prevent unavailable items from being sold and reflect real kitchen production constraints.

**Features:** Stock limits, overselling prevention, ready-in-advance versus made-on-order rules, out-of-stock controls, and peak-hour customization rules.

**Deliverables:** Inventory model, availability service, atomic reservation/decrement behavior, kitchen controls, and replenishment workflow.

**Dependencies:** Sprint 6 backend, item catalog ownership, and kitchen operating rules.

**Acceptance criteria**

- Checkout revalidates stock before confirming an order.
- Concurrent orders cannot exceed available stock.
- Kitchen staff can pause or restore item availability.
- Preparation-mode rules are visible and testable.
- Peak-hour rules fail safely and can be overridden by authorized staff.

**Risks:** Inventory drift, race conditions, incorrect recipes/yields, and staff override misuse.

**Completion status:** Planned.

**Recommended Git milestone:** `Sprint 9: add inventory and live menu availability`

---

## Sprint 10 — Analytics and Operational Readiness

**Objective:** Make CampusBite measurable, deployable, supportable, and ready for a controlled campus pilot.

**Features:** Sales, fulfillment rate, wait time, peak periods, best sellers, kitchen efficiency, deployment checklist, and pilot checklist.

**Deliverables:** Defined metrics, role-appropriate dashboards, privacy-aware event pipeline, production runbook, monitoring/alerts, rollback plan, and pilot report template.

**Dependencies:** Reliable backend events from Sprints 6–9 and agreed operational targets.

**Acceptance criteria**

- Metric definitions are documented and reconcile with source records.
- Dashboards avoid unnecessary personal data.
- Production deployment, rollback, backup, and incident steps are rehearsed.
- Pilot entry/exit criteria, support ownership, and feedback channels are agreed.
- Accessibility, performance, security, and failure-mode checks pass before launch.

**Risks:** Misleading metrics, privacy leakage, insufficient monitoring, unsupported peak load, and expanding the pilot before exit criteria are met.

**Completion status:** Planned.

**Recommended Git milestone:** `Sprint 10: prepare analytics deployment and campus pilot`

---

## Recommended sequencing and gates

1. Treat Sprint 3.5 as the UI-stability gate for the local prototype.
2. Complete Sprint 4 only after kitchen staff validate the current workflow terminology.
3. Use Sprint 5 to confirm the tracking experience before committing to a real-time transport.
4. Do not begin production authentication or payment handling without the Sprint 6 server-side source of truth.
5. Gate Sprint 8 on merchant onboarding, webhook verification, refund ownership, and appropriate business/tax advice.
6. Gate the Sprint 10 pilot on security, privacy, accessibility, backup/restore, monitoring, and load testing.
