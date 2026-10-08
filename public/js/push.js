// Installing the app to the home screen and turning push notifications on for this device.
import { get, post, del } from './lib.js';

const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);
export const isMobile = isIOS || isAndroid;
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// iPhones only allow notifications once the app is on the home screen.
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Android/desktop Chrome's own install prompt, kept until we offer it.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('appinstalled', () => { deferredInstall = null; });
export const canPromptInstall = () => Boolean(deferredInstall);
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  return outcome === 'accepted';
}

export const registration = () => navigator.serviceWorker.ready;

export async function currentSubscription() {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

function deviceName() {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (isIOS) return 'iPad';
  if (isAndroid) return 'Android phone';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Asks permission (must follow a tap) and registers this device. Resolves to a status:
// 'on' | 'denied' | 'unsupported'.
export async function enablePush(ui = 'hub') {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const { public_key: key } = await get('/me/notify');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key can't be used; replace it.
  if (sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await post('/push/subscriptions', { ...sub.toJSON(), device: deviceName(), ui });
  return 'on';
}

// Announcements on a phone without an account (from the app's More tab).
export async function enableGuestPush(campusId = null) {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const { public_key: key } = await get('/push/key');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await post('/push/guest', { ...sub.toJSON(), device: deviceName(), campus_id: campusId });
  return 'on';
}

export async function disableGuestPush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await del('/push/guest', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await del('/push/subscriptions', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
