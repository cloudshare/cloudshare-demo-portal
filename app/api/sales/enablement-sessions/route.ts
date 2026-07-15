// Public Sales vocabulary uses "enablement sessions". Keep the original route
// implementation as a compatibility alias until persisted table/API consumers
// can be migrated without risking existing session history.
export { GET, POST } from "../demo-sessions/route";
