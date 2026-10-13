import Chat from "@/components/Chat";
import { demoKeyRequired } from "@/lib/demo-key";
import { activeModel } from "@/lib/kimi";

// Reads KIMI_API_KEY and ARIA_DEMO_KEY at request time so the page reflects the running server.
export const dynamic = "force-dynamic";

export default function Page() {
  return <Chat initialModel={activeModel()} debugLocked={demoKeyRequired()} />;
}
