# CloudShare Demo Portal — Context

A demo (grounded in reality) of a **certification provider portal** that lets a customer's
end-users log in, schedule, and consume real CloudShare lab sessions for an exam.

**Primary goal: demonstrate CloudShare's capabilities** — real experience provisioning,
sponsored-link login, suspend/resume, and scoring — through a believable portal. The
provider / customer / training framing is set dressing; when a choice trades portal richness
against showing real CloudShare behaviour, CloudShare wins.

This glossary is the source of truth for the project's language. It is not a spec.

## Language

### Actors & organisations

**Certification Provider** (brand: **Certalis**):
The company that owns and operates the portal. In this codebase the portal **is** the
Certification Provider — it is not an external system. Certalis builds the CloudShare
integration and runs the infrastructure, but holds **no global CloudShare credentials** — each
Customer supplies its own encrypted Connection. Certalis's isolated Sales workspace is itself a
seeded Customer when it needs a Connection.
_Avoid_: Kryterion, proctoring vendor.

**Customer** (brand: **Helios CX**):
An organisation that is a customer of both the Certification Provider and CloudShare. The
Customer **owns its CloudShare subscription** and supplies its CloudShare API credentials to
the portal. Its admin curates which CloudShare environments are offered as certifications to
its candidates. Modelled as a tenant/data entity, not an external API. The demo seeds Helios CX
for certification and Certalis for the isolated Sales Admin workspace; multi-tenant management is
still deferred.
_Avoid_: Genesys, client, account, tenant (when speaking of the org itself).

**Candidate**:
An end-user belonging to a Customer who logs into the portal, schedules, and sits a
certification session. The primary self-service actor.
_Avoid_: student, learner, user (when a Candidate is meant).

**Certalis Admin**:
Provider-side operator who manages portal infrastructure and onboards Customers.
_Avoid_: superadmin.

**Certalis Sales Admin**:
An existing-role `admin` user belonging to the seeded Certalis Customer. The Customer's persisted
workspace configuration routes this user to the Sales workspace; it is not a brand-name exception,
a cross-Customer administrator, or a reduced `sales_pro` role. This workspace is isolated from
Helios CX certification data and may use its own encrypted per-Customer CloudShare Connection.
_Avoid_: superadmin, sales_pro.

**Helios Admin** (Customer Admin):
Customer-side operator who logs into the portal and defines which CloudShare environments
are available to that Customer's Candidates.
_Avoid_: manager.

### Portal & CloudShare

**Portal**:
The web application being built — the Certalis portal.

**CloudShare Subscription**:
A CloudShare account **owned by a Customer** (Helios for the demo), containing one or more
**Projects**. Each Customer brings its own subscription.

**CloudShare Connection**:
The CloudShare API credentials a Customer admin enters **into the portal** to authorise it to act
on their CloudShare subscription: a **single API ID + API key** (used for both v3 and v4 — only
the per-request auth mechanism differs) plus the **webhook secret**. Stored per-Customer and
encrypted at rest; the Provider never sees raw keys. The CloudShare integration client is
instantiated **per-Customer** from this connection — never from global config. Validated via the
v3 `ping` → `pong` request (v4 has no health probe). For v3 `cs_sha1`, the per-request token
is a CloudShare-defined nonce: exactly **10 alphanumeric characters**. Do not substitute UUIDs or
other token shapes.

**Lab**:
A CloudShare environment made available to a Candidate for a certification session.

**LabLaunch**:
The provisioning flow, run **at scheduling time**: create the Experience (type `instructorLed`,
`start` = the scheduled time) → assign the Candidate as Participant → create the Sponsored Link.
Cheap and immediate — no VMs run yet. The environment is provisioned by CloudShare **on login**
(a warm **Standby** if created ≥5h ahead, otherwise cold). The Candidate's own time-gated login
redirect, at the scheduled time, is a distinct step. The portal owns the
`trainingId ↔ Candidate ↔ environmentId` mapping; the environmentId is unknown until login and is
discovered via the v4 list-students-in-a-training endpoint, since the CloudShare environment webhook
carries no experience reference (see ADR-003).

**Entitlement**:
The server-side decision that a Candidate may access a specific Lab for a specific attempt.
Always recomputed from persisted state; never trusted from the client.

**Sponsored Link**:
The CloudShare-issued `loginUrl` that logs a person directly into their environment within an
Experience. It is a **bearer credential** — it encodes the experience and the user's access in one
token, so anyone holding it can enter that user's environment while the experience window and
policy are live. Therefore server-only: stored on the `LabLaunch`, never returned to the client or
shown in the Portal. The Candidate reaches it only via a server-side 302 from a Portal endpoint
opened in a retained child window (so the URL stays out of the Portal UI and client code, and the
opener can monitor liveness).

**IntegrationEvent**:
An inbound or outbound event exchanged with CloudShare.

**Diagnostic Log Entry**:
An admin-support record describing something the Portal or CloudShare integration did or received:
HTTP requests, webhook deliveries, platform events, audit-worthy actions, failures, retries, and
state transitions. Diagnostic Log Entries are the primary object of the support area. They should be
correlatable to the relevant **Customer**, **Candidate**, **Exam**, **ExamAttempt**, CloudShare
identifiers, and correlation ID where known. They are distinct from Session Monitoring queues, which
summarise current ExamAttempt state rather than explain platform behaviour. Diagnostic logging is
not limited to failures: successful scheduling, provisioning, sponsored-link creation, enter
redirects, suspend/resume, heartbeat auto-suspend, score retrieval, webhook handling, and admin
catalog changes should also leave enough trace data to reconstruct how the Portal behaved.
Diagnostic Log Entries are append-only evidence: do not rewrite old entries to add identifiers that
were unknown at the time. When later actions discover new identifiers, such as a CloudShare
environment ID, emit later entries that include both the new identifier and the initiating thread's
known identifiers, such as ExamAttempt ID, Exam ID, Candidate email, and Customer.
For candidate exam support, **ExamAttempt ID** is the primary diagnostic thread because it identifies
one Candidate taking one Exam. **Exam ID** identifies the catalog item and is used for Exam lifecycle
diagnostics such as authoring, publishing, unpublishing, editing, and future deletion/archive actions;
those entries should not invent an ExamAttempt ID. Non-attempt diagnostics use the most specific
known thread: Candidate account actions use Candidate identity, CloudShare resource reads use
Customer plus operation/resource identifiers, and webhook entries start from Customer plus
CloudShare environment ID/event data before later correlation ties them to Candidate, ExamAttempt,
and Exam where possible.

**Displayed date/time convention**:
Portal-facing dates/times use deterministic ISO 8601-style formatting rather than locale-specific
month/day/year rendering. Keep the `YYYY-MM-DD...` ordering everywhere. When a view is showing UTC
or another non-local reference time, label that timezone/context explicitly. Candidate-facing local
scheduling views may still show local time, but they keep the same ISO-style ordering.

**Session Monitoring**:
The admin surface for current ExamAttempt state: scheduled, ready, in progress, suspended, completed,
and expired views. It answers "what is happening now?" and may summarise active operational state,
but it is not the primary forensic support log.

**Support**:
The admin surface for correlated Diagnostic Log Entries. It answers "what happened, in what order,
and how can support trace it?" Support should not duplicate Session Monitoring queues as its main
workflow; it should provide searchable diagnostic evidence across Portal actions, CloudShare
requests, webhooks, events, and state transitions.

**Audit Trail**:
The admin record of who changed or attempted to change important Portal state and whether that action
was allowed. Audit Trail answers "who changed what?" and is separate from Support diagnostics, which
answer "what did the platform do and how can support trace behaviour?" Some actions should emit both
an audit record and a Diagnostic Log Entry.

**Event Log**:
An internal/source stream of platform events, not a primary support workflow. Long-term, events that
matter to support should appear as Diagnostic Log Entries or correlated diagnostic timeline rows
rather than forcing admins to inspect a separate Event Log UI.

A Diagnostic Log Entry should try to carry a consistent support field set: occurred time, level,
source, operation, outcome, Customer ID, message, and details. Candidate email, Exam ID,
ExamAttempt ID, correlation ID, CloudShare identifiers, request metadata, and response metadata are
nullable because some diagnostics occur before or outside those relationships. Nullable fields
should be populated whenever they are known at the time of the entry.
The long-term support model should be a typed **DiagnosticLogEntry** read/write model: a generic
platform trace with nullable domain anchors, not an Exam-only log. Free-form data may remain in
`details`, `request`, and `response`, but core correlation fields such as Customer, actor, subject,
operation, outcome, correlation ID, external IDs, Candidate email, Exam ID, and ExamAttempt ID must
be first-class so support filtering and tracing are reliable.
Existing prototype support-log rows are not product data and should not constrain the new model.
They may be discarded, reset, or archived during development; do not preserve a legacy shape if it
weakens the DiagnosticLogEntry design.
Protected diagnostics use a direction-aware contract: redact actual request-header values, but retain
all request/query and provider-response body data verbatim. Body evidence includes API keys, bearer
tokens, webhook secrets, passphrases, access links, sponsored-link `loginUrl` values, and analogous
fields, without field-name or value-pattern scrubbing. This Customer-scoped evidence remains
server-only and must never appear in generic logs, candidate/client-facing responses or Portal UI,
browser state/console, non-admin APIs, or another Customer's diagnostics. Admin-only
DiagnosticLogEntry and Support Diagnostics surfaces may display it as support evidence. A
sensitive diagnostic mode may exist for replicable issues where redaction prevents diagnosis, but it
must be explicit, audited, time-boxed with automatic expiry, disabled by default, scoped as narrowly
as possible, and clearly visible to operators while enabled.
The first DiagnosticLogEntry write-path slice should instrument the most support-critical flows:
Candidate account creation; Candidate login/logout attempts; Customer admin login/logout attempts;
Candidate ExamAttempt scheduling; CloudShare training creation; Candidate participant/student add;
sponsored-link creation; Candidate enter/resume/suspend; CloudShare webhook receive/verify/reconcile;
Guided Journey score retrieval; and CloudShare resource-sync reads. Exam authoring and lifecycle
changes should also emit diagnostics alongside audits, but are lower priority than the candidate
exam delivery path.

### CloudShare resources

**Project**:
The top organisational layer within a Subscription. Owns **Policies**, **Teams**, and
**Project Members**; Experiences are created within a Project, and Blueprints are listed
per Project for portal authoring (v3 `GET /api/v3/projects/{projectId}/blueprints`).

**Project Member**:
A user within a Project, holding one of three roles — **Project Manager** (all permissions),
**Team Manager** (subset), **Team Member** (further subset) — with per-Project custom permissions
not reliably retrievable via API. A member may hold an **API ID + key**; the Customer's
CloudShare Connection is such a member's credential, often a service account.

**Team**:
A subdivision of a Project for RBAC grouping. Often a Project has just one; a Project Manager
belongs to all teams.

**Policy**:
A Project-scoped setting defining the lifetime of an environment. An Exam selects one Policy from
the selected Project (v3 `GET /api/v3/projects/{projectId}/policies`). A broader
`GET /api/v3/policies` surface may return visible policies across Projects for a CloudShare
Connection, but the portal does not treat that as the primary contract. Policy detail is read
through the undocumented but live-observed v3 path
`GET /api/v3/projects/{projectId}/policies/{policyId}` when lease evidence is needed:
`runtimeLeaseMinutes` feeds the Certalis ExamAttempt timer, while `storageLeaseMinutes` is
continuous CloudShare retention/TTL evidence.

**Blueprint**:
A reusable "folder" of environment metadata plus **Snapshots**. Can exist across Projects and
Subscriptions, but the portal discovers and presents Blueprints through the selected Project
(v3 `GET /api/v3/projects/{projectId}/blueprints`).

**Snapshot**:
A saved state of an environment's VMs and network configuration. Up to five per Blueprint
(first-in-first-out); one is the **default** (often the latest unless a CloudShare instructor/project
manager changes it) and is what provisions an environment for **experience-based** launches. The
portal models Snapshot discovery as part of selected Project + Blueprint detail, including the
default-Snapshot signal, not as a global top-level resource list. The portal does **not** choose an
arbitrary non-default Snapshot when launching an Exam through a CloudShare Experience; any such
change must happen by changing the Blueprint's default inside CloudShare first.

**Region**:
A CloudShare data-centre location. In CloudShare v3 this is effectively platform-global:
`GET /api/v3/regions` currently returns the same shared Region set regardless of Project. The
portal treats Regions as a global reference list, retrieved and refreshable rather than hard-coded.
When showing them to admins, prefer `friendlyName` over the raw `name`.

**Experience**:
The CloudShare (Accelerate) session that binds a Blueprint + Project + Policy + Region +
**Instructor** + **Participants**. A `LabLaunch` creates one. (Ignore Classic "experiences" /
training / classes — only the Accelerate experience model applies.)

**Instructor**:
A Project Member assigned to an Experience. For the demo, a seeded service-account member.

**Participant**:
An end user added to an Experience — i.e. the Candidate sitting the exam. Individual exam delivery
uses one Participant per Experience; cohort exam delivery uses many Participants in one Experience.

**Standby**:
A generic, pre-provisioned environment CloudShare prepares ahead of an `instructorLed`
experience's start (the reason experiences should start ≥5h after creation). It becomes the
Participant's environment when bound to them at login. If none is warm, the environment is
cold-provisioned at login in a few minutes.

**Guided Journey**:
An optional, pre-configured set of scored tasks within a CloudShare experience, set up in CloudShare
before the experience is created. There is **no API to discover whether one exists** for an
experience, so each Exam carries an explicit flag stating whether to retrieve scores.

### Exams & certifications

**Exam**:
The **catalog item** the Helios admin publishes. Binds a single CloudShare provisioning tuple —
**Project + Blueprint + Snapshot** (the Blueprint's current default for experience-based launches)
**+ Region + Policy + Instructor** —
plus candidate-facing metadata (title, description, **per-Exam time limit**, manually authored
**open period**, published/draft flag, and a **score-retrieval flag** stating whether the underlying
blueprint has a Guided Journey to score). Exam authoring is **Project-first**: the Helios admin selects a Project, then chooses
Project-scoped Blueprints, Policies, and Blueprint-detail Snapshots for that Project; Region comes
from the global Region reference list. Instructor is the explicitly configured seeded CloudShare
service-account member until a Project-member read endpoint is verified. For Slice 2, the selected
Policy's `runtimeLeaseMinutes` is the portal's exam time-limit source rather than a manual admin
override. `openPeriodMinutes` is manually editable and defines the CloudShare training/Experience
End (`scheduledFor + openPeriodMinutes`); it must be at least the runtime time limit and, when
Policy `storageLeaseMinutes` is known, no longer than that storage retention. `storageLeaseMinutes`
is retained as Policy evidence and validation/review context, not as the direct scheduling End.
An Exam explicitly controls whether it is available for Individual Exam Delivery, Cohort Exam
Sessions, or both.
The Candidate is added as the single Participant at launch, not at definition time. What a Candidate
selects and consumes; the unit this portal actually delivers.
_Avoid_: test, assessment; do **not** call the catalog item a "Certification".

**Individual Exam Delivery**:
The current exam delivery mode where a Candidate chooses their own start time and the portal creates
a dedicated one-Participant CloudShare Experience for that Candidate's ExamAttempt.
_Avoid_: private exam, single-user experience.

**Cohort Exam Session**:
A Helios Admin-created exam session where many Candidates join the same long-running on-demand
CloudShare Experience during an admin-defined availability window. Each Candidate keeps an
independent ExamAttempt clock even though the CloudShare Experience is shared, and retiring the
session preserves its history rather than deleting the consumed Experience. It inherits the Exam's
CloudShare resource tuple rather than re-authoring Blueprint, Policy, allowed Region set,
Instructor, or Guided Journey settings.
_Avoid_: scheduled attempt, demo session.

### Future sales delivery

**Sales Workspace**:
The configuration-selected, Certalis Customer-scoped administration entry point for future sales
delivery. It is intentionally empty in the initial slice and must not expose Helios CX Exams,
Candidates, CloudShare Connections, audits, or diagnostics.

**Sales Opportunity**:
A future commercial engagement with one prospective organisation. It may group multiple related
Sales Experiences, including a replacement when a prior time-bounded experience has ended.
_Avoid_: Customer, Cohort Exam Session.

**Sales Enablement Session**:
A time-bounded Certalis delivery run within a Sales Opportunity, backed by one CloudShare Sales
Experience and supporting demo, proof-of-concept, proof-of-value, or trial work. It combines one
catalogue Item with explicit start/end/timezone and a Main Sales Pro selected from a fresh live
Project-member read. It is distinct from a Cohort Exam Session even where delivery structures are
analogous. The Item owns the Project/resources; the Sales Pro belongs to the Session, never to the
Item configuration.
_Avoid_: Exam, Cohort Exam Session, generic session.

**Sales Experience**:
The CloudShare v4 resource backing a Sales Enablement Session.

**Certification**:
The whole path/journey a Candidate takes — training plus one or more exams, some potentially
outside CloudShare. Acknowledged as the real-world umbrella but **deliberately not built**; the
demo models a single **Exam** within it.

**ExamAttempt**:
A Candidate's specific attempt at an Exam — the spine the launch, timer, and scoring hang off.
Candidates may not hold overlapping active ExamAttempts for the same Exam, even across different
delivery modes or Cohort Exam Sessions.
When the Exam open period closes, an attempt is presented as **expired** if it never started
Candidate runtime/scorable work, and as **completed** if it did start runtime/scorable work
(`in_progress`, `suspended`, or an already completed attempt). This presentation distinction keeps
closed-but-never-used attempts separate from attempts that may have Guided Journey score evidence.
_Avoid_: booking, session (when the ExamAttempt aggregate is meant).
