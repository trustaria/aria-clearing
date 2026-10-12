import { loadDashboard } from "../../../../lib/dashboard-data";
import { publisherStore } from "../../../../lib/publisher";
import { createPublisherHandlers } from "./handlers";

export const dynamic = "force-dynamic";

const handlers = createPublisherHandlers({ store: publisherStore, load: loadDashboard });

export const GET = handlers.GET;
export const POST = handlers.POST;
