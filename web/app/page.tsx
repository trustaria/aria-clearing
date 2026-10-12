import Chat from "@/components/Chat";
import { activeModel } from "@/lib/kimi";

// Reads KIMI_API_KEY at request time so the stub badge reflects the running server.
export const dynamic = "force-dynamic";

export default function Page() {
  return <Chat initialModel={activeModel()} />;
}
