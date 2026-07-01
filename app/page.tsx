export const dynamic = "force-dynamic";

import { getChats } from "@/lib/actions";
import Dashboard from "./components/Dashboard";

export default async function Page() {
  const chats = await getChats();
  return <Dashboard initialChats={chats} />;
}
