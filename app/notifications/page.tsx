import { NotificationSettings } from "@/components/NotificationSettings";
import { getCatalog } from "@/lib/catalog/repository";
export const metadata = { title: "Notification settings" };
export default async function NotificationsPage() {
  const { festivals } = await getCatalog();
  return <NotificationSettings festivals={festivals.map(({ slug, name }) => ({ id: slug, name }))} />;
}
