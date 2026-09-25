import type { ActionFunctionArgs } from "react-router";
import { DEFAULT_ENGINE_KEY } from "../services/commission-engine.server";
import { handleEngineRequest } from "../services/simulated-engine.server";

/**
 * The simulated commission engine's endpoint. Not a Shopify route: it takes
 * the engine's own bearer token, not a session. See
 * `services/simulated-engine.server.ts`.
 */
export const loader = () =>
  new Response("POST a commission to this endpoint.", { status: 405 });

export const action = ({ request }: ActionFunctionArgs) =>
  handleEngineRequest(
    request,
    // eslint-disable-next-line no-undef
    process.env.COMMISSION_ENGINE_KEY?.trim() || DEFAULT_ENGINE_KEY,
  );
