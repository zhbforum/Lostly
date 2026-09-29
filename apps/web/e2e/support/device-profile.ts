import { devices, type BrowserContextOptions } from '@playwright/test';

export function deviceProfile(name: string) {
  // Descriptor data includes screen, but Playwright's DeviceDescriptor type omits it.
  // Unlike viewport, screen must also be passed through the contextOptions fixture.
  const device: (typeof devices)[string] & Pick<BrowserContextOptions, 'screen'> = devices[name];
  if (!device?.screen) throw new Error(`Missing screen dimensions for device: ${name}`);
  return { ...device, contextOptions: { screen: device.screen } };
}
