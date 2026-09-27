import { nativeBridge, type NativeActionResults } from './native-bridge';

export const device = {
  sync(payload: Parameters<typeof nativeBridge.call<'ui.sync'>>[1]) {
    return nativeBridge.call('ui.sync', payload);
  },
  ensureCameraPermission() {
    return nativeBridge.call('camera.ensurePermission', {});
  },
  calendarStatus(date: string): Promise<NativeActionResults['calendar.status']> {
    return nativeBridge.call('calendar.status', { date });
  },
  toggleCalendar(payload: Parameters<typeof nativeBridge.call<'calendar.toggle'>>[1]) {
    return nativeBridge.call('calendar.toggle', payload);
  },
  requestNotificationPermission() {
    return nativeBridge.call('notify.requestPermission', {});
  },
  pickImage() {
    return nativeBridge.call('media.pickImage', {});
  },
  importMedia(kind: 'image' | 'video') {
    return nativeBridge.call('media.import', { kind });
  },
  storeMedia(payload: Parameters<typeof nativeBridge.call<'media.store'>>[1]) {
    return nativeBridge.call('media.store', payload);
  },
  shareText(title: string, text: string) {
    return nativeBridge.call('share.text', { title, text });
  },
  exportCsv(filename: string, content: string) {
    return nativeBridge.call('export.csv', { filename, content });
  },
};
