import { NotificationSettings } from "@/components/NotificationSettings";
import { festivals } from "@/data/festivals";
export const metadata = { title: "Notification settings" };
export default function NotificationsPage() { return <NotificationSettings festivals={festivals.map(({ slug, name }) => ({ id: slug, name }))} />; }
