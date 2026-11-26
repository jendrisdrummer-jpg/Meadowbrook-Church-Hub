// The dashboard greeting, from the hour (0-23) on this device's clock.
// 5:00-11:59 morning, 12:00-16:59 afternoon, 17:00-4:59 evening.
export function greetingForHour(hour) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}
