import { buildFixtureMap, type FixtureMap } from "../fixtures";
import v4OauthToken from "./v4-oauth-token.json";
import v4Projects from "./v4-projects.json";
import v3Regions from "./v3-regions.json";
import v4CreateExperience from "./v4-create-experience.json";
import v4AddStudent from "./v4-add-student.json";
import v4SponsoredLink from "./v4-sponsored-link.json";
import v4GetParticipantProgress from "./v4-get-participant-progress.json";
import v3Blueprints from "./v3-blueprints.json";
import v3Policies from "./v3-policies.json";

/**
 * The bundled fixture corpus, assembled from static JSON imports rather than a
 * runtime directory read. Static imports are traced by the bundler, so this works
 * inside the Next.js server runtime where a dynamic `fs` read of the fixtures dir
 * would not be reliably included. `loadFixturesFromDir` remains for tests.
 */
// NOTE: each fixture's `path` must be the full URL pathname (e.g.
// "/v4/experiences"), NOT the short path passed to requestV4 ("/experiences").
// The fixture transport keys on `new URL(request.url).pathname`, so the v4/v3
// base-URL prefix is part of the lookup key.
export const bundledFixtures: FixtureMap = buildFixtureMap([
  { raw: v4OauthToken, label: "v4-oauth-token.json" },
  { raw: v4Projects, label: "v4-projects.json" },
  { raw: v3Regions, label: "v3-regions.json" },
  { raw: v4CreateExperience, label: "v4-create-experience.json" },
  { raw: v4AddStudent, label: "v4-add-student.json" },
  { raw: v4SponsoredLink, label: "v4-sponsored-link.json" },
  { raw: v4GetParticipantProgress, label: "v4-get-participant-progress.json" },
  { raw: v3Blueprints, label: "v3-blueprints.json" },
  { raw: v3Policies, label: "v3-policies.json" },
]);
