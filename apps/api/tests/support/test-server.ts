import { createApp } from '@/app';
import { MemoryObjectStorage } from './memory-storage';

if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== '/lostly_test' ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error('The browser test server requires a disposable lostly_test database');
}

const storage = new MemoryObjectStorage();
const app = createApp(storage).get('/__test/images/*', ({ params, query, status }) => {
  if (!query.expires || Number(query.expires) <= Date.now()) return status(403, 'Expired');
  const image = storage.objects.get(params['*']);
  return image ? new Response(image) : status(404, 'Not found');
});
app.listen(3000);
