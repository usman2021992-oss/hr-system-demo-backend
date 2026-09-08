import { ensureSuperAdmin } from './seedUtils';

export async function productionSeed(): Promise<void> {
  if (process.env.PRODUCTION_SEED !== 'true') {
    return;
  }
  await ensureSuperAdmin();
}
