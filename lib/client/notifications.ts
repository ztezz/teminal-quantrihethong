export type NotificationPermissionResult = NotificationPermission | "unsupported";

export function notificationPermission(): NotificationPermissionResult {
  return typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : "unsupported";
}

export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

export async function showNotification(
  title: string,
  options?: NotificationOptions,
): Promise<Notification | null> {
  if (notificationPermission() !== "granted") return null;

  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) {
    await registration.showNotification(title, options);
    return null;
  }
  return new Notification(title, options);
}
