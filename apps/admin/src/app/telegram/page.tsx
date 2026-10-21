import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { TelegramSettings } from "../../components/TelegramSettings";
export default async function TelegramPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <TelegramSettings csrfToken={session.csrfToken} />;
}
