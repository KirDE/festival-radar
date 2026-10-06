// Preserve historical /logos/<slug>.png URLs after static archive assets retire.
export { GET, HEAD } from '../../api/logos/[filename]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
