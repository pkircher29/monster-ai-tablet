import { fileURLToPath } from 'node:url';

export const DEFAULT_HUB_STATIC_DIRECTORY = fileURLToPath(
  new URL('../../../hub-web/dist/', import.meta.url),
);
