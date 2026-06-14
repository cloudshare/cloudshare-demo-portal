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
integration and runs the infrastructure, but **holds no CloudShare credentials of its own** —
each Customer supplies their own.
_Avoid_: Kryterion, proctoring vendor.

**Customer** (brand: **Helios CX**):
An organisation that is a customer of both the Certification Provider and CloudShare. The
Customer **owns its CloudShare subscription** and supplies its CloudShare API credentials to
the portal. Its admin curates which CloudShare environments are offered as certifications to
its candidates. Modelled as a tenant/data entity, not an external API. The demo seeds exactly
one Customer (Helios); multi-tenant support is deferred.
_Avoid_: Genesys, client, account, tenant (when speaking of the org itself).

**Candidate**:
An end-user belonging to a Customer who logs into the portal, schedules, and sits a
certification session. The primary self-service actor.
_Avoid_: student, learner, user (when a Candidate is meant).

**Certalis Admin**:
Provider-side operator who manages portal infrastructure and onboards Customers.
_Avoid_: superadmin.

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
Connection, but the portal does not treat that as the primary contract.

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

**Experience**:
The CloudShare (Accelerate) session that binds a Blueprint + Project + Policy + Region +
**Instructor** + **Participants**. A `LabLaunch` creates one. (Ignore Classic "experiences" /
training / classes — only the Accelerate experience model applies.)

**Instructor**:
A Project Member assigned to an Experience. For the demo, a seeded service-account member.

**Participant**:
An end user added to an Experience — i.e. the Candidate sitting the exam. An exam Experience has
a single Participant.

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
plus candidate-facing metadata (title, description, **per-Exam time limit**, published/draft flag,
and a **score-retrieval flag** stating whether the underlying blueprint has a Guided Journey to
score). Exam authoring is **Project-first**: the Helios admin selects a Project, then chooses
Project-scoped Blueprints, Policies, later Instructor choices, and Blueprint-detail Snapshots for
that Project; Region comes from the global Region reference list. The Candidate is added as the
single Participant at launch, not at definition time. What a Candidate selects and consumes; the
unit this portal actually delivers.
_Avoid_: test, assessment; do **not** call the catalog item a "Certification".

**Certification**:
The whole path/journey a Candidate takes — training plus one or more exams, some potentially
outside CloudShare. Acknowledged as the real-world umbrella but **deliberately not built**; the
demo models a single **Exam** within it.

**ExamAttempt**:
A Candidate's specific attempt at an Exam — the spine the launch, timer, and scoring hang off.
_Avoid_: booking, session (when the ExamAttempt aggregate is meant).
