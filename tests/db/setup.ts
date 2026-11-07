import { afterAll } from 'vitest';
import { cleanupTestData } from './helpers';

// Every DB test file removes what it created (trips, their bookings and photo
// files, members, test accounts) so the shared local database doesn't grow.
afterAll(cleanupTestData, 120_000);
